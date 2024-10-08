import {
  accounts,
  authenticators,
  contacts,
  convoAttachments,
  convoEntries,
  convoEntryPrivateVisibilityParticipants,
  convoEntryRawHtmlEmails,
  convoEntryReplies,
  convoEntrySeenTimestamps,
  convoParticipants,
  convoParticipantTeamMembers,
  convos,
  convoSeenTimestamps,
  convoSubjects,
  domains,
  emailIdentities,
  emailIdentitiesAuthorizedSenders,
  emailIdentitiesPersonal,
  emailIdentityExternal,
  emailRoutingRules,
  emailRoutingRulesDestinations,
  orgInvitations,
  orgMemberProfiles,
  orgModules,
  orgMembers,
  orgPostalConfigs,
  orgs,
  pendingAttachments,
  postalServers,
  sessions,
  teamMembers,
  teams,
  spaces,
  spaceMembers,
  spaceWorkflows,
  spaceTags
} from '@u22n/database/schema';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '~platform/utils/auth/passkeys';
import {
  COOKIE_PASSKEY_CHALLENGE,
  COOKIE_ELEVATED_TOKEN,
  COOKIE_TWO_FACTOR_RESET_CHALLENGE
} from '~platform/utils/cookieNames';
import {
  sendPasswordRecoveryEmail,
  sendRecoveryEmailConfirmation
} from '~platform/utils/mail/transactional';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from '@simplewebauthn/types';
import {
  billingTrpcClient,
  mailBridgeTrpcClient
} from '~platform/utils/tRPCServerClients';
import {
  strongPasswordSchema,
  calculatePasswordStrength
} from '@u22n/utils/password';
import { accountIdentifier, ratelimiter } from '~platform/trpc/ratelimit';
import { createAuthenticator } from '~platform/utils/auth/passkeyUtils';
import { refreshOrgShortcodeCache } from '~platform/utils/orgShortcode';
import { deleteCookie, getCookie, setCookie } from '@u22n/hono/helpers';
import { router, accountProcedure } from '~platform/trpc/trpc';
import { TOTPController, createTOTPKeyURI } from 'oslo/otp';
import { inArray, isNotNull } from '@u22n/database/orm';
import { publicProcedure } from '~platform/trpc/trpc';
import { nanoIdToken } from '@u22n/utils/zodSchemas';
import { typeIdValidator } from '@u22n/utils/typeid';
import { decodeHex, encodeHex } from 'oslo/encoding';
import { zodSchemas } from '@u22n/utils/zodSchemas';
import type { TrpcContext } from '~platform/ctx';
import { lucia } from '~platform/utils/auth';
import { and, eq } from '@u22n/database/orm';
import { storage } from '~platform/storage';
import { datePlus } from '@u22n/utils/ms';
import { Argon2id } from 'oslo/password';
import { TRPCError } from '@trpc/server';
import { env } from '~platform/env';
import { z } from 'zod';

async function checkIfElevated(ctx: TrpcContext) {
  const elevatedCookie = getCookie(ctx.event, COOKIE_ELEVATED_TOKEN);
  if (!elevatedCookie) return false;
  const elevatedToken = await storage.elevatedTokens.getItem(elevatedCookie);
  if (!elevatedToken) return false;
  if (
    elevatedToken.issuer.accountId !== ctx.account?.id ||
    elevatedToken.issuer.sessionId !== ctx.account?.session.id ||
    elevatedToken.issuer.deviceIp !==
      (ctx.event.env.incoming.socket.remoteAddress ?? '<unknown>')
  )
    return false;
  return true;
}

async function revokeElevation(ctx: TrpcContext) {
  const elevatedCookie = getCookie(ctx.event, COOKIE_ELEVATED_TOKEN);
  if (!elevatedCookie) return;
  await storage.elevatedTokens.removeItem(elevatedCookie);
  deleteCookie(ctx.event, COOKIE_ELEVATED_TOKEN);
}

const elevatedProcedure = accountProcedure.use(async ({ ctx, next }) => {
  if (!(await checkIfElevated(ctx)))
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message:
        'You are not allowed to perform elevated action at this moment. Please try again'
    });
  return next();
});

export const securityRouter = router({
  // Elevated Mode
  checkIfElevated: accountProcedure.query(async ({ ctx }) => ({
    isElevated: await checkIfElevated(ctx)
  })),

  generatePasskeyVerificationChallenge: accountProcedure.mutation(
    async ({ ctx }) => {
      const { event, account } = ctx;

      const accountQuery = await ctx.db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Account credentials not found'
        });
      }

      const passkeyVerificationChallenge = nanoIdToken();

      setCookie(event, COOKIE_PASSKEY_CHALLENGE, passkeyVerificationChallenge, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        expires: datePlus('5 minutes'),
        domain: env.PRIMARY_DOMAIN
      });

      const passkeyOptions = await generateAuthenticationOptions({
        authChallengeId: passkeyVerificationChallenge,
        accountId: accountQuery.id
      });

      return { options: passkeyOptions };
    }
  ),

  grantElevation: accountProcedure
    .input(
      z.union([
        z.object({ mode: z.literal('PASSKEY'), passkeyResponse: z.any() }),
        z.object({
          mode: z.literal('PASSWORD'),
          password: z.string().min(8),
          twoFactorCode: z.string().min(6).max(6).nullable()
        })
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const { account, db } = ctx;

      if (input.mode === 'PASSKEY') {
        const passkeyResponse =
          input.passkeyResponse as AuthenticationResponseJSON;
        const challengeCookie = getCookie(ctx.event, COOKIE_PASSKEY_CHALLENGE);

        if (!challengeCookie) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Passkey challenge not found'
          });
        }

        const passkeyVerification = await verifyAuthenticationResponse({
          authenticationResponse: passkeyResponse,
          authChallengeId: challengeCookie
        });

        if (
          !passkeyVerification.result.verified ||
          !passkeyVerification.result.authenticationInfo
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Passkey verification failed'
          });
        }
      } else if (input.mode === 'PASSWORD') {
        const accountQuery = await db.query.accounts.findFirst({
          where: eq(accounts.id, account.id),
          columns: {
            passwordHash: true,
            twoFactorSecret: true,
            twoFactorEnabled: true
          }
        });

        if (!accountQuery) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found'
          });
        }

        if (!accountQuery.passwordHash) {
          throw new TRPCError({
            code: 'METHOD_NOT_SUPPORTED',
            message: 'Password is not enabled'
          });
        }

        const validPassword = await new Argon2id().verify(
          accountQuery.passwordHash,
          input.password
        );

        if (!validPassword) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Invalid password or 2FA code'
          });
        }

        if (accountQuery.twoFactorEnabled && accountQuery.twoFactorSecret) {
          if (!input.twoFactorCode)
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '2FA code is required'
            });
          const secret = decodeHex(accountQuery.twoFactorSecret);
          const isValid = await new TOTPController().verify(
            input.twoFactorCode,
            secret
          );
          if (!isValid) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'Invalid password or 2FA code'
            });
          }
        }
      } else {
        // There is no way to get here, still throwing error to be safe
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid input'
        });
      }

      // At this point we have verified the passkey or password and 2FA code

      const elevationToken = nanoIdToken();
      await storage.elevatedTokens.setItem(elevationToken, {
        issuer: {
          accountId: account.id,
          sessionId: account.session.id,
          deviceIp: ctx.event.env.incoming.socket.remoteAddress ?? '<unknown>'
        }
      });

      setCookie(ctx.event, COOKIE_ELEVATED_TOKEN, elevationToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        expires: datePlus('5 minutes'),
        domain: env.PRIMARY_DOMAIN
      });

      return { success: true };
    }),

  // Overview
  getOverview: accountProcedure.query(async ({ ctx }) => {
    const { db, account } = ctx;

    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        publicId: true,
        passwordHash: true,
        recoveryCode: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
        recoveryEmailHash: true,
        recoveryEmailVerifiedAt: true
      },
      with: {
        authenticators: {
          columns: {
            publicId: true,
            createdAt: true,
            nickname: true
          }
        },
        sessions: {
          columns: {
            sessionToken: true,
            publicId: true,
            os: true,
            device: true,
            createdAt: true
          }
        }
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Account not found'
      });
    }

    return {
      passwordSet: Boolean(accountQuery.passwordHash),
      twoFactorEnabled:
        accountQuery.twoFactorEnabled && Boolean(accountQuery.twoFactorSecret),
      recoveryCodeSet: Boolean(accountQuery.recoveryCode),
      recoveryEmailSet: Boolean(accountQuery.recoveryEmailHash),
      recoveryEmailVerifiedAt: accountQuery.recoveryEmailVerifiedAt,
      passkeys: accountQuery.authenticators || [],
      sessions:
        accountQuery.sessions.map(({ sessionToken: _, ...rest }) => rest) || [],
      thisDevice: accountQuery.sessions.find(
        (s) => s.sessionToken === account.session.id
      )?.publicId
    };
  }),

  // Password
  checkPasswordStrength: accountProcedure
    .input(z.object({ password: z.string() }))
    .query(({ input }) => calculatePasswordStrength(input.password)),

  changeOrEnablePassword: elevatedProcedure
    .input(z.object({ newPassword: strongPasswordSchema }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;

      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      const passwordHash = await new Argon2id().hash(input.newPassword);

      await db
        .update(accounts)
        .set({ passwordHash })
        .where(eq(accounts.id, accountQuery.id));

      await revokeElevation(ctx);

      return { success: true };
    }),

  // Disabling Password would also disable 2FA
  // User can't disable password if they don't have atleast one passkey
  disablePassword: elevatedProcedure.mutation(async ({ ctx }) => {
    const { db, account } = ctx;
    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        id: true,
        passwordHash: true,
        twoFactorSecret: true
      },
      with: {
        authenticators: {
          columns: {
            id: true
          }
        }
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    if (!accountQuery.passwordHash) {
      throw new TRPCError({
        code: 'METHOD_NOT_SUPPORTED',
        message: 'Password is already disabled'
      });
    }

    if (accountQuery.authenticators.length < 1) {
      throw new TRPCError({
        code: 'METHOD_NOT_SUPPORTED',
        message: 'You must have at least one passkey to disable password'
      });
    }

    await db
      .update(accounts)
      .set({
        passwordHash: null,
        twoFactorSecret: null,
        twoFactorEnabled: false
      })
      .where(eq(accounts.id, accountQuery.id));

    await revokeElevation(ctx);

    return { success: true };
  }),

  // 2FA
  generateTwoFactorResetChallenge: elevatedProcedure.query(async ({ ctx }) => {
    const { db, account } = ctx;

    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        publicId: true,
        username: true
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    const existingChallenge = getCookie(
      ctx.event,
      COOKIE_TWO_FACTOR_RESET_CHALLENGE
    );

    if (existingChallenge)
      await storage.twoFactorResetChallenges.removeItem(existingChallenge);

    const newSecret = crypto.getRandomValues(new Uint8Array(20));

    const uri = createTOTPKeyURI(
      'UnInbox.com',
      accountQuery.username,
      newSecret
    );

    const twoFactorResetChallenge = nanoIdToken();

    await storage.twoFactorResetChallenges.setItem(twoFactorResetChallenge, {
      account: {
        username: accountQuery.username,
        publicId: accountQuery.publicId
      },
      secret: encodeHex(newSecret)
    });

    setCookie(
      ctx.event,
      COOKIE_TWO_FACTOR_RESET_CHALLENGE,
      twoFactorResetChallenge,
      {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        expires: datePlus('5 minutes'),
        domain: env.PRIMARY_DOMAIN
      }
    );

    return { uri };
  }),

  enableOrResetTwoFactor: elevatedProcedure
    .input(z.object({ code: z.string().min(6).max(6) }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;
      const twoFactorResetChallenge = getCookie(
        ctx.event,
        COOKIE_TWO_FACTOR_RESET_CHALLENGE
      );

      if (!twoFactorResetChallenge) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA Challenge not found or expired, please try again'
        });
      }

      const storedChallenge = await storage.twoFactorResetChallenges.getItem(
        twoFactorResetChallenge
      );
      if (!storedChallenge) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: '2FA Challenge not found or expired, please try again'
        });
      }

      const secret = decodeHex(storedChallenge.secret);
      const isValid = await new TOTPController().verify(input.code, secret);

      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid 2FA code'
        });
      }

      await db
        .update(accounts)
        .set({
          twoFactorSecret: storedChallenge.secret,
          twoFactorEnabled: true
        })
        .where(eq(accounts.id, account.id));

      deleteCookie(ctx.event, COOKIE_TWO_FACTOR_RESET_CHALLENGE);
      await storage.twoFactorResetChallenges.removeItem(
        twoFactorResetChallenge
      );

      return { success: true };
    }),

  disableTwoFactor: elevatedProcedure.mutation(async ({ ctx }) => {
    const { db, account } = ctx;
    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        id: true,
        twoFactorSecret: true,
        twoFactorEnabled: true
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    if (!accountQuery.twoFactorEnabled || !accountQuery.twoFactorSecret) {
      throw new TRPCError({
        code: 'METHOD_NOT_SUPPORTED',
        message: '2FA is already disabled'
      });
    }

    await db
      .update(accounts)
      .set({ twoFactorEnabled: false, twoFactorSecret: null })
      .where(eq(accounts.id, accountQuery.id));

    await revokeElevation(ctx);

    return { success: true };
  }),

  // Recovery Code
  enableOrResetRecoveryCode: elevatedProcedure.mutation(async ({ ctx }) => {
    const { account, db } = ctx;

    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        publicId: true,
        username: true
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    const newRecoveryCode = nanoIdToken();

    await db
      .update(accounts)
      .set({ recoveryCode: await new Argon2id().hash(newRecoveryCode) })
      .where(eq(accounts.id, account.id));

    return { recoveryCode: newRecoveryCode, username: accountQuery.username };
  }),

  disableRecoveryCode: elevatedProcedure.mutation(async ({ ctx }) => {
    const { account, db } = ctx;

    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        publicId: true,
        username: true
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    await db
      .update(accounts)
      .set({ recoveryCode: null })
      .where(eq(accounts.id, account.id));

    return { success: true };
  }),

  // Passkeys
  generatePasskeyCreationChallenge: elevatedProcedure.mutation(
    async ({ ctx }) => {
      const { account, db } = ctx;
      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          publicId: true,
          username: true
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      const passkeyOptions = await generateRegistrationOptions({
        userDisplayName: accountQuery.username,
        username: accountQuery.username,
        accountPublicId: accountQuery.publicId
      });

      return { options: passkeyOptions };
    }
  ),

  createNewPasskey: elevatedProcedure
    .input(z.object({ passkeyResponse: z.any() }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;

      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true,
          publicId: true,
          username: true
        },
        with: {
          authenticators: {
            columns: {
              id: true
            }
          }
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      const registrationResponse =
        input.passkeyResponse as RegistrationResponseJSON;

      const passkeyVerification = await verifyRegistrationResponse({
        registrationResponse: registrationResponse,
        publicId: accountQuery.publicId
      });

      if (
        !passkeyVerification.verified ||
        !passkeyVerification.registrationInfo
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Passkey verification failed'
        });
      }

      const passkeyType =
        passkeyVerification.registrationInfo.credentialDeviceType ===
        'multiDevice'
          ? 'Synced'
          : 'Native';

      const passkeyNickname =
        accountQuery.authenticators.length === 0
          ? `Passkey (${passkeyType})`
          : `Passkey ${accountQuery.authenticators.length + 1} (${passkeyType})`;

      const createdPasskey = await createAuthenticator(
        {
          accountId: accountQuery.id,
          credentialID: passkeyVerification.registrationInfo.credentialID,
          credentialPublicKey:
            passkeyVerification.registrationInfo.credentialPublicKey,
          credentialDeviceType:
            passkeyVerification.registrationInfo.credentialDeviceType,
          credentialBackedUp:
            passkeyVerification.registrationInfo.credentialBackedUp,
          transports: registrationResponse.response.transports,
          counter: passkeyVerification.registrationInfo.counter
        },
        passkeyNickname
      );

      if (!createdPasskey.credentialID) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Something went wrong adding your passkey, please try again'
        });
      }

      return { success: true };
    }),
  renamePasskey: accountProcedure
    .input(
      z.object({
        passkeyPublicId: typeIdValidator('accountPasskey'),
        newNickname: z
          .string()
          .min(2, 'Nickname must be at least 2 characters')
          .max(64, 'Nickname can be at most 64 characters')
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;
      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true,
          publicId: true,
          username: true
        },
        with: {
          authenticators: {
            columns: {
              publicId: true,
              createdAt: true,
              nickname: true
            }
          }
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      const passkeyQuery = await db.query.authenticators.findFirst({
        where: and(
          eq(authenticators.publicId, input.passkeyPublicId),
          eq(authenticators.accountId, accountQuery.id)
        ),
        columns: {
          id: true,
          publicId: true
        }
      });

      if (!passkeyQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Passkey not found'
        });
      }

      await db
        .update(authenticators)
        .set({ nickname: input.newNickname })
        .where(
          and(
            eq(authenticators.accountId, accountQuery.id),
            eq(authenticators.id, passkeyQuery.id)
          )
        );

      return { success: true };
    }),
  // User can't delete passkeys if they don't have atleast one passkey or a password is set
  deletePasskey: elevatedProcedure
    .input(z.object({ passkeyPublicId: typeIdValidator('accountPasskey') }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;
      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true,
          passwordHash: true
        },
        with: {
          authenticators: {
            columns: {
              publicId: true
            }
          }
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      if (
        !accountQuery.passwordHash &&
        accountQuery.authenticators.length <= 1
      ) {
        throw new TRPCError({
          code: 'METHOD_NOT_SUPPORTED',
          message: 'You must have at least one passkey, or a password set'
        });
      }

      if (
        !accountQuery.authenticators.find(
          (a) => a.publicId === input.passkeyPublicId
        )
      ) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Passkey not found'
        });
      }

      await db
        .delete(authenticators)
        .where(
          and(
            eq(authenticators.publicId, input.passkeyPublicId),
            eq(authenticators.accountId, accountQuery.id)
          )
        );

      // If it was the last passkey or only remaining passkey with password, we need to revoke the elevation token
      if (
        accountQuery.authenticators.length === 1 ||
        (accountQuery.passwordHash && accountQuery.authenticators.length === 2)
      )
        await revokeElevation(ctx);

      return { success: true };
    }),

  // Sessions
  removeSession: elevatedProcedure
    .input(z.object({ sessionPublicId: typeIdValidator('accountSession') }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;

      const accountData = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true,
          publicId: true
        }
      });

      if (!accountData) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        });
      }

      const sessionQuery = await db.query.sessions.findFirst({
        where: and(
          eq(sessions.publicId, input.sessionPublicId),
          eq(sessions.accountId, accountData.id)
        ),
        columns: {
          id: true,
          publicId: true,
          sessionToken: true
        }
      });

      if (!sessionQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found'
        });
      }

      // If the session is the current session, we need to revoke the elevation token
      if (sessionQuery.sessionToken === account.session.id)
        await revokeElevation(ctx);

      await lucia.invalidateSession(sessionQuery.sessionToken);

      return { success: true };
    }),

  removeAllSessions: elevatedProcedure.mutation(async ({ ctx }) => {
    const { db, account } = ctx;
    const accountId = account.id;

    const accountData = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: {
        id: true,
        publicId: true
      }
    });

    if (!accountData) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found'
      });
    }

    await lucia.invalidateUserSessions(accountData.id);
    await revokeElevation(ctx);
    return { success: true };
  }),

  // Recovery Email
  setupOrUpdateRecoveryEmail: elevatedProcedure
    .use(
      // Ratelimit upto 3 requests every 12 hours to prevent spamming emails
      ratelimiter({
        limit: 3,
        namespace: 'account.security.setupOrUpdateRecoveryEmail',
        duration: '12h',
        createIdentifier: accountIdentifier
      })
    )
    .input(z.object({ recoveryEmail: z.string().email().trim() }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;

      const accountQuery = await db.query.accounts.findFirst({
        where: eq(accounts.id, account.id),
        columns: {
          id: true,
          publicId: true,
          username: true
        }
      });

      if (!accountQuery) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Account data not found'
        });
      }

      const recoveryEmailHash = await new Argon2id().hash(input.recoveryEmail);

      await db
        .update(accounts)
        .set({ recoveryEmailHash, recoveryEmailVerifiedAt: null })
        .where(eq(accounts.id, account.id));

      const verificationCode = nanoIdToken(6);
      await storage.recoveryEmailVerificationCodes.setItem(verificationCode, {
        account: {
          id: accountQuery.id,
          publicId: accountQuery.publicId
        },
        recoveryEmail: input.recoveryEmail
      });

      await sendRecoveryEmailConfirmation({
        to: input.recoveryEmail,
        username: accountQuery.username,
        recoveryEmail: input.recoveryEmail,
        verificationCode: verificationCode,
        expiryDate: datePlus('15 minutes').toDateString()
      });

      return { success: true };
    }),

  verifyRecoveryEmail: accountProcedure
    .input(z.object({ verificationCode: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { db, account } = ctx;
      const storedCode = await storage.recoveryEmailVerificationCodes.getItem(
        input.verificationCode
      );

      if (!storedCode || storedCode.account.id !== account.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The verification code is invalid or has expired'
        });
      }

      await db
        .update(accounts)
        .set({ recoveryEmailVerifiedAt: new Date() })
        .where(eq(accounts.id, account.id));

      await storage.recoveryEmailVerificationCodes.removeItem(
        input.verificationCode
      );

      return { success: true };
    }),

  disableRecoveryEmail: elevatedProcedure.mutation(async ({ ctx }) => {
    const { db, account } = ctx;
    const accountQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        id: true,
        publicId: true,
        username: true
      }
    });

    if (!accountQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Account data not found'
      });
    }

    await db
      .update(accounts)
      .set({ recoveryEmailHash: null, recoveryEmailVerifiedAt: null })
      .where(eq(accounts.id, accountQuery.id));

    return { success: true };
  }),

  sendRecoveryEmail: publicProcedure
    .use(
      ratelimiter({
        limit: 10,
        namespace: 'account.security.sendRecoveryEmail'
      })
    )
    .input(
      z.object({
        username: zodSchemas.usernameLogin().trim(),
        email: z.string().email().trim()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { db } = ctx;

      const accountQuery = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.username, input.username),
          isNotNull(accounts.recoveryEmailHash)
        ),
        columns: {
          id: true,
          publicId: true,
          username: true,
          recoveryEmailHash: true
        }
      });

      if (!accountQuery?.recoveryEmailHash) {
        // To prevent username/email enumeration, we'll return success even if the account doesn't exist
        return { success: true };
      }

      const isValidEmail = await new Argon2id().verify(
        accountQuery.recoveryEmailHash,
        input.email
      );

      if (!isValidEmail) {
        // To prevent username/email enumeration, we'll return success even if the email doesn't match
        return { success: true };
      }

      const recoveryToken = nanoIdToken(6);
      await storage.accountRecoveryVerificationCodes.setItem(recoveryToken, {
        account: {
          username: accountQuery.username,
          id: accountQuery.id,
          publicId: accountQuery.publicId
        }
      });

      await sendPasswordRecoveryEmail({
        to: input.email,
        username: accountQuery.username,
        recoveryCode: recoveryToken,
        expiryDate: datePlus('15 minutes').toLocaleString()
      });

      return { success: true };
    }),
  deleteAccountPre: elevatedProcedure.query(async ({ ctx }) => {
    const { db, account } = ctx;
    const accountOrgsQuery = await db.query.accounts.findFirst({
      where: eq(accounts.id, account.id),
      columns: {
        username: true
      },
      with: {
        orgMemberships: {
          columns: {
            id: true,
            role: true
          },
          with: {
            org: {
              columns: {
                publicId: true,
                name: true,
                avatarTimestamp: true,
                ownerId: true,
                shortcode: true
              }
            }
          }
        }
      }
    });

    if (!accountOrgsQuery) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Account not in any orgs'
      });
    }

    const ownedOrgs = accountOrgsQuery.orgMemberships.filter(
      (orgMembership) => orgMembership.org.ownerId === account.id
    );
    const memberOrgs = accountOrgsQuery.orgMemberships.filter(
      (orgMembership) => orgMembership.org.ownerId !== account.id
    );

    return {
      username: accountOrgsQuery.username,
      ownedOrgs: ownedOrgs.map((orgMembership) => {
        return {
          publicId: orgMembership.org.publicId,
          name: orgMembership.org.name,
          avatarTimestamp: orgMembership.org.avatarTimestamp,
          shortcode: orgMembership.org.shortcode
        };
      }),
      memberOrgs: memberOrgs.map((orgMembership) => {
        return {
          publicId: orgMembership.org.publicId,
          name: orgMembership.org.name,
          avatarTimestamp: orgMembership.org.avatarTimestamp,
          shortcode: orgMembership.org.shortcode
        };
      })
    };
  }),
  deleteAccountConfirm: elevatedProcedure.mutation(async ({ ctx }) => {
    const { db, account } = ctx;

    // delete user objects
    await db
      .update(accounts)
      .set({
        passwordHash: null,
        recoveryCode: null,
        recoveryEmailHash: null,
        recoveryEmailVerifiedAt: null,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        metadata: { deleted: new Date() }
      })
      .where(eq(accounts.id, account.id));
    await db
      .delete(authenticators)
      .where(eq(authenticators.accountId, account.id));

    // delete user sessions
    await lucia.invalidateUserSessions(account.id);

    // delete org memberships

    const orgMembersQuery = await db.query.orgMembers.findMany({
      where: eq(orgMembers.accountId, account.id),
      columns: {
        id: true,
        publicId: true
      },
      with: {
        org: {
          columns: {
            id: true
          }
        }
      }
    });

    if (orgMembersQuery.length > 0) {
      const orgMemberIdsArray = orgMembersQuery.map(
        (orgMember) => orgMember.id
      );
      const orgIdsArray = orgMembersQuery.map((orgMember) => orgMember.org.id);

      await Promise.allSettled(
        orgIdsArray.map(async (orgId) => {
          // Update org user count
          await refreshOrgShortcodeCache(orgId);
        })
      );

      await db
        .update(orgMembers)
        .set({
          removedAt: new Date(),
          accountId: null,
          status: 'removed'
        })
        .where(inArray(orgMembers.id, orgMemberIdsArray));

      if (!ctx.selfHosted) {
        await Promise.allSettled(
          orgIdsArray.map(async (orgId) => {
            await billingTrpcClient.stripe.subscriptions.updateOrgUserCount.mutate(
              { orgId }
            );
          })
        );
      }
    }

    // delete orgs

    const orgsQuery = await db.query.orgs.findMany({
      where: eq(orgs.ownerId, account.id),
      columns: {
        id: true,
        publicId: true,
        shortcode: true
      },
      with: {
        postalConfig: true
      }
    });

    if (orgsQuery.length > 0) {
      const orgIdsArray = orgsQuery.map((org) => org.id);

      await db
        .transaction(async (db) => {
          try {
            await db.delete(orgs).where(inArray(orgs.id, orgIdsArray));
            await db
              .delete(orgInvitations)
              .where(inArray(orgInvitations.orgId, orgIdsArray));
            await db
              .delete(orgModules)
              .where(inArray(orgModules.orgId, orgIdsArray));
            await db
              .delete(orgPostalConfigs)
              .where(inArray(orgPostalConfigs.orgId, orgIdsArray));
            await db
              .delete(orgMembers)
              .where(inArray(orgMembers.orgId, orgIdsArray));
            await db
              .delete(orgMemberProfiles)
              .where(inArray(orgMemberProfiles.orgId, orgIdsArray));
            await db.delete(teams).where(inArray(teams.orgId, orgIdsArray));
            await db
              .delete(teamMembers)
              .where(inArray(teamMembers.orgId, orgIdsArray));
            await db.delete(domains).where(inArray(domains.orgId, orgIdsArray));
            await db
              .delete(postalServers)
              .where(inArray(postalServers.orgId, orgIdsArray));
            await db
              .delete(contacts)
              .where(inArray(contacts.orgId, orgIdsArray));
            await db
              .delete(emailRoutingRules)
              .where(inArray(emailRoutingRules.orgId, orgIdsArray));
            await db
              .delete(emailRoutingRulesDestinations)
              .where(inArray(emailRoutingRulesDestinations.orgId, orgIdsArray)),
              await db
                .delete(emailIdentities)
                .where(inArray(emailIdentities.orgId, orgIdsArray));
            await db
              .delete(emailIdentitiesAuthorizedSenders)
              .where(
                inArray(emailIdentitiesAuthorizedSenders.orgId, orgIdsArray)
              );
            await db
              .delete(emailIdentitiesPersonal)
              .where(inArray(emailIdentitiesPersonal.orgId, orgIdsArray));
            await db
              .delete(emailIdentityExternal)
              .where(inArray(emailIdentityExternal.orgId, orgIdsArray));
            await db.delete(convos).where(inArray(convos.orgId, orgIdsArray));
            await db
              .delete(convoSubjects)
              .where(inArray(convoSubjects.orgId, orgIdsArray));
            await db
              .delete(convoParticipants)
              .where(inArray(convoParticipants.orgId, orgIdsArray));
            await db
              .delete(convoParticipantTeamMembers)
              .where(inArray(convoParticipantTeamMembers.orgId, orgIdsArray));
            await db
              .delete(convoAttachments)
              .where(inArray(convoAttachments.orgId, orgIdsArray));
            await db
              .delete(pendingAttachments)
              .where(inArray(pendingAttachments.orgId, orgIdsArray));
            await db
              .delete(convoEntries)
              .where(inArray(convoEntries.orgId, orgIdsArray));
            await db
              .delete(convoEntryReplies)
              .where(inArray(convoEntryReplies.orgId, orgIdsArray));
            await db
              .delete(convoEntryPrivateVisibilityParticipants)
              .where(
                inArray(
                  convoEntryPrivateVisibilityParticipants.orgId,
                  orgIdsArray
                )
              );
            await db
              .delete(convoEntryRawHtmlEmails)
              .where(inArray(convoEntryRawHtmlEmails.orgId, orgIdsArray));
            await db
              .delete(convoSeenTimestamps)
              .where(inArray(convoSeenTimestamps.orgId, orgIdsArray));
            await db
              .delete(convoEntrySeenTimestamps)
              .where(inArray(convoEntrySeenTimestamps.orgId, orgIdsArray));
            await db.delete(spaces).where(inArray(spaces.orgId, orgIdsArray));
            await db
              .delete(spaceMembers)
              .where(inArray(spaceMembers.orgId, orgIdsArray));
            await db.delete(domains).where(inArray(domains.orgId, orgIdsArray));
            await db
              .delete(spaceWorkflows)
              .where(inArray(spaceWorkflows.orgId, orgIdsArray));
            await db
              .delete(spaceTags)
              .where(inArray(spaceTags.orgId, orgIdsArray));
          } catch (e) {
            console.error(e);
          }
        })
        .catch(() => {
          console.error(
            'Failed to delete some data, still continuing with deletion',
            orgsQuery.map((org) => org.id)
          );
        });

      const orgPublicIdsArray = orgsQuery.map((org) => org.publicId);

      // Delete orgs from Postal DB
      await Promise.allSettled(
        orgsQuery
          .filter((org) => org.postalConfig)
          .map(({ publicId }) =>
            mailBridgeTrpcClient.postal.org.deletePostalOrg.mutate({
              orgPublicId: publicId
            })
          )
      );

      // Delete orgShortcode Cache

      const orgShortcodesArray = orgsQuery.map((org) => org.shortcode);
      await Promise.allSettled(
        orgShortcodesArray.map(async (orgShortcode) => {
          await storage.orgContext.removeItem(orgShortcode);
        })
      );

      // Delete attachments

      const deleteStorageResponse = (await fetch(
        `${env.STORAGE_URL}/api/orgs/delete`,
        {
          method: 'post',
          headers: {
            'Content-Type': 'application/json',
            Authorization: env.STORAGE_KEY
          },
          body: JSON.stringify({
            orgPublicIds: orgPublicIdsArray
          })
        }
      ).then((res) => res.json())) as unknown;

      if (!deleteStorageResponse) {
        console.error('🔥 Failed to delete attachments from storage', {
          orgPublicIdsArray
        });
      }

      // Delete Billing
      if (!ctx.selfHosted) {
        await Promise.all(
          orgIdsArray.map(async (orgId) => {
            await billingTrpcClient.stripe.subscriptions.cancelOrgSubscription.mutate(
              {
                orgId: orgId
              }
            );
          })
        );
      }
    }

    return true;
  })
});
