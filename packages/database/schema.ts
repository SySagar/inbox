import {
  int,
  tinyint,
  smallint,
  mediumint,
  bigint,
  boolean,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  serial,
  timestamp,
  index,
  json,
  uniqueIndex,
  varchar,
  text,
  mediumtext,
  longtext
} from 'drizzle-orm/mysql-core';
import {
  spaceMemberNotificationArray,
  spaceMemberRoleArray,
  spaceWorkflowTypeArray
} from '@u22n/utils/spaces';
import { typeIdDataType as publicId } from '@u22n/utils/typeid';
import { uiColors } from '@u22n/utils/colors';
import { relations, sql } from 'drizzle-orm';

const stripeBillingPeriods = ['monthly', 'yearly'] as const;
const stripePlanNames = ['starter', 'pro'] as const;

//TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit

const foreignKey = (name: string) =>
  bigint(name, { unsigned: true, mode: 'number' });

//******************* */
//* Account tables

export type AccountMetaBonus = {
  item: 'unin';
  bonus: { enabled: boolean };
  bonusReason: string;
  awardedByName: string;
  awardedByAccountId: number;
  awardedAt: Date;
  note: string;
};
export type AccountMetadata = {
  deleted?: Date;
  bonuses?: AccountMetaBonus[];
};

export const accounts = mysqlTable(
  'accounts',
  // eslint-disable-next-line @u22n/custom/table-needs-org-id
  {
    id: serial('id').primaryKey(),
    publicId: publicId('account', 'public_id').notNull(),
    username: varchar('username', { length: 32 }).notNull(),
    metadata: json('metadata').$type<AccountMetadata>(),
    createdAt: timestamp('created_at').$defaultFn(() => new Date()),
    lastLoginAt: timestamp('last_login_at'),
    passwordHash: varchar('password_hash', { length: 255 }),
    recoveryEmailHash: varchar('recovery_email_hash', { length: 255 }),
    recoveryEmailVerifiedAt: timestamp('recovery_email_verified_at'),
    twoFactorSecret: varchar('two_factor_secret', { length: 255 }),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    recoveryCode: varchar('recovery_code', { length: 256 })
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    usernameIndex: uniqueIndex('username_idx').on(table.username)
  })
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  authenticators: many(authenticators),
  sessions: many(sessions),
  orgMemberships: many(orgMembers),
  orgMemberProfiles: many(orgMemberProfiles),
  personalEmailIdentities: many(emailIdentitiesPersonal)
}));

// transports type comes from @simplewebauthn/types AuthenticatorTransportFuture
export const authenticators = mysqlTable(
  'authenticators',
  // eslint-disable-next-line @u22n/custom/table-needs-org-id
  {
    id: serial('id').primaryKey(),
    publicId: publicId('accountPasskey', 'public_id').notNull(),
    accountId: foreignKey('account_id').notNull(),
    nickname: varchar('nickname', { length: 64 }).notNull(),
    credentialID: varchar('credential_id', { length: 255 }).notNull(), //Uint8Array
    credentialPublicKey: text('credential_public_key').notNull(), //Uint8Array
    counter: bigint('counter', { unsigned: true, mode: 'bigint' }).notNull(), //bigint
    credentialDeviceType: varchar('credential_device_type', {
      length: 32
    }).notNull(),
    credentialBackedUp: boolean('credential_backed_up').notNull(),
    transports:
      json('transports').$type<
        (
          | 'ble'
          | 'cable'
          | 'hybrid'
          | 'internal'
          | 'nfc'
          | 'smart-card'
          | 'usb'
        )[]
      >(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    credentialIDIndex: uniqueIndex('credential_id_idx').on(table.credentialID)
  })
);

export const authenticatorRelationships = relations(
  authenticators,
  ({ one }) => ({
    account: one(accounts, {
      fields: [authenticators.accountId],
      references: [accounts.id]
    })
  })
);

export const sessions = mysqlTable(
  'sessions',
  // eslint-disable-next-line @u22n/custom/table-needs-org-id
  {
    id: serial('id').primaryKey(),
    publicId: publicId('accountSession', 'public_id').notNull(),
    accountId: foreignKey('account_id').notNull(),
    accountPublicId: publicId('account', 'account_public_id').notNull(),
    sessionToken: varchar('session_token', { length: 255 }).notNull(),
    device: varchar('device', { length: 255 }).notNull(),
    os: varchar('os', { length: 255 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    accountIdIndex: index('account_id_idx').on(table.accountId),
    sessionTokenIndex: uniqueIndex('session_token_idx').on(table.sessionToken),
    expiryIndex: index('expires_at_idx').on(table.expiresAt)
  })
);
export const sessionRelationships = relations(sessions, ({ one }) => ({
  account: one(accounts, {
    fields: [sessions.accountId],
    references: [accounts.id]
  })
}));

//******************* */
//* ORG DATA
export type OrgMetaBonus = {
  item: 'domain';
  bonus: { count: number } | { enabled: boolean };
  bonusReason: string;
  awardedByName: string;
  awardedByAccountId: number;
  awardedAt: Date;
  note: string;
};
export type OrgMetadata = {
  bonuses?: OrgMetaBonus[];
};

export const orgs = mysqlTable(
  'orgs',
  // eslint-disable-next-line @u22n/custom/table-needs-org-id
  {
    id: serial('id').primaryKey(),
    publicId: publicId('org', 'public_id').notNull(),
    avatarTimestamp: timestamp('avatar_timestamp'),
    shortcode: varchar('shortcode', { length: 64 }).notNull(),
    ownerId: foreignKey('owner_id').notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    metadata: json('metadata').$type<OrgMetadata>().default({}),
    migratedToSpaces: boolean('migrated_to_spaces').notNull().default(false),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    shortcodeIndex: uniqueIndex('shortcode_idx').on(table.shortcode)
  })
);
export const orgsRelations = relations(orgs, ({ one, many }) => ({
  owner: one(accounts, {
    fields: [orgs.ownerId],
    references: [accounts.id]
  }),
  members: many(orgMembers),
  domains: many(domains),
  postalServers: many(postalServers),
  postalConfig: one(orgPostalConfigs, {
    fields: [orgs.id],
    references: [orgPostalConfigs.orgId]
  }),
  modules: many(orgModules),
  orgMemberProfiles: many(orgMemberProfiles)
}));

export const orgInvitations = mysqlTable(
  'org_invitations',
  {
    id: serial('id').primaryKey(),
    publicId: publicId('orgInvitations', 'public_id').notNull(),
    orgId: foreignKey('org_id').notNull(),
    invitedByOrgMemberId: foreignKey('invited_by_org_member_id').notNull(),
    role: mysqlEnum('role', ['member', 'admin']).notNull(),
    orgMemberId: foreignKey('org_member_id'),
    invitedOrgMemberProfileId: foreignKey('invited_org_member_profile_id'),
    email: varchar('email', { length: 128 }),
    inviteToken: varchar('invite_token', { length: 64 }),
    invitedAt: timestamp('invited_at')
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: timestamp('expires_at'),
    acceptedAt: timestamp('accepted_at')
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    orgMemberIdIndex: uniqueIndex('org_member_id_idx').on(table.orgMemberId),
    orgEmailUniqueIndex: uniqueIndex('org_email_unique_idx').on(
      table.orgId,
      table.email
    )
  })
);
export const orgInvitationsRelations = relations(orgInvitations, ({ one }) => ({
  org: one(orgs, {
    fields: [orgInvitations.orgId],
    references: [orgs.id]
  }),
  invitedByOrgMember: one(orgMembers, {
    fields: [orgInvitations.invitedByOrgMemberId],
    references: [orgMembers.id]
  }),
  orgMember: one(orgMembers, {
    fields: [orgInvitations.orgMemberId],
    references: [orgMembers.id]
  }),
  invitedProfile: one(orgMemberProfiles, {
    fields: [orgInvitations.invitedOrgMemberProfileId],
    references: [orgMemberProfiles.id]
  })
}));

// Opt-ins/modules/add-ons/boosts tables
export const orgModules = mysqlTable(
  'org_modules',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    module: mysqlEnum('module', [
      'strip signatures',
      'anonymous analytics'
    ]).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    lastModifiedByOrgMember: foreignKey(
      'last_modified_by_org_member'
    ).notNull(),
    lastModifiedAt: timestamp('last_modified_at'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    orgModuleIndex: uniqueIndex('org_module_idx').on(table.orgId, table.module)
  })
);

export const orgModulesRelations = relations(orgModules, ({ one }) => ({
  org: one(orgs, {
    fields: [orgModules.orgId],
    references: [orgs.id]
  }),
  lastModifiedByOrgMember: one(orgMembers, {
    fields: [orgModules.lastModifiedByOrgMember],
    references: [orgMembers.id]
  })
}));

export const orgPostalConfigs = mysqlTable(
  'org_postal_configs',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    host: varchar('host', { length: 32 }).notNull(),
    ipPools: json('ip_pools').notNull().$type<string[]>(),
    defaultIpPool: varchar('default_ip_pool', { length: 32 }).notNull()
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);

export const orgPostalConfigsRelations = relations(
  orgPostalConfigs,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [orgPostalConfigs.orgId],
      references: [orgs.id]
    }),
    domains: many(domains)
  })
);

//* Org Members

// changes to status and role must be reflected in types OrgContext
export const orgMembers = mysqlTable(
  'org_members',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('orgMembers', 'public_id').notNull(),
    accountId: foreignKey('account_id'),
    invitedByOrgMemberId: foreignKey('invited_by_org_member_id'),
    status: mysqlEnum('status', ['invited', 'active', 'removed']).notNull(),
    role: mysqlEnum('role', ['member', 'admin']).notNull(),
    personalSpaceId: foreignKey('personal_space_id'),
    orgMemberProfileId: foreignKey('org_member_profile_id').notNull(),
    defaultEmailIdentityId: foreignKey('default_email_identity_id'),
    addedAt: timestamp('added_at')
      .notNull()
      .$defaultFn(() => new Date()),
    removedAt: timestamp('removed_at')
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    accountIdIndex: index('account_id_idx').on(table.accountId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    orgAccountIndex: uniqueIndex('org_account_idx').on(
      table.orgId,
      table.accountId
    )
  })
);
export const orgMembersRelations = relations(orgMembers, ({ one, many }) => ({
  account: one(accounts, {
    fields: [orgMembers.accountId],
    references: [accounts.id]
  }),
  org: one(orgs, {
    fields: [orgMembers.orgId],
    references: [orgs.id]
  }),
  profile: one(orgMemberProfiles, {
    fields: [orgMembers.orgMemberProfileId],
    references: [orgMemberProfiles.id]
  }),
  personalSpace: one(spaces, {
    fields: [orgMembers.personalSpaceId],
    references: [spaces.id]
  }),
  defaultEmailIdentity: one(emailIdentities, {
    fields: [orgMembers.defaultEmailIdentityId],
    references: [emailIdentities.id]
  }),
  spaceMemberships: many(spaceMembers, { relationName: 'member' })
}));

export const orgMemberProfiles = mysqlTable(
  'org_member_profiles',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('orgMemberProfile', 'public_id').notNull(),
    avatarTimestamp: timestamp('avatar_timestamp'),
    accountId: foreignKey('account_id'),
    firstName: varchar('first_name', { length: 64 }),
    lastName: varchar('last_name', { length: 64 }),
    handle: varchar('handle', { length: 64 }),
    title: varchar('title', { length: 64 }),
    blurb: text('blurb'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    accountIdIndex: index('account_id_idx').on(table.accountId)
  })
);

export const orgMemberProfileRelations = relations(
  orgMemberProfiles,
  ({ one }) => ({
    account: one(accounts, {
      fields: [orgMemberProfiles.accountId],
      references: [accounts.id]
    }),
    org: one(orgs, {
      fields: [orgMemberProfiles.orgId],
      references: [orgs.id]
    }),
    orgMember: one(orgMembers, {
      fields: [orgMemberProfiles.id],
      references: [orgMembers.orgMemberProfileId]
    })
  })
);

export const teams = mysqlTable(
  'teams',
  {
    id: serial('id'), // -> removed pk from here
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('teams', 'public_id').notNull(),
    avatarTimestamp: timestamp('avatar_timestamp'),
    name: varchar('name', { length: 128 }).notNull(),
    color: mysqlEnum('color', [...uiColors]),
    description: text('description'),
    defaultEmailIdentityId: foreignKey('default_email_identity_id'),
    defaultSpaceId: foreignKey('default_space_id'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    // moved pk here
    pk: primaryKey({ columns: [table.id], name: 'teams_id' }),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
  org: one(orgs, {
    fields: [teams.orgId],
    references: [orgs.id]
  }),
  defaultEmailIdentity: one(emailIdentities, {
    fields: [teams.defaultEmailIdentityId],
    references: [emailIdentities.id]
  }),
  members: many(teamMembers),
  spaceMemberships: many(spaceMembers),
  defaultSpace: one(spaces, {
    fields: [teams.defaultSpaceId],
    references: [spaces.id]
  })
}));

export const teamMembers = mysqlTable(
  'team_members',
  {
    id: serial('id'), // -> removed pk from here
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('teamMembers', 'public_id').notNull(),
    teamId: foreignKey('team_id').notNull(),
    orgMemberId: foreignKey('org_member_id').notNull(),
    orgMemberProfileId: foreignKey('org_member_profile_id'),
    addedBy: foreignKey('added_by').notNull(),
    role: mysqlEnum('role', ['member', 'admin']).notNull().default('member'),
    notifications: mysqlEnum('notifications', ['active', 'muted', 'off'])
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    // moved pk here
    pk: primaryKey({ columns: [table.id], name: 'team_members_id' }),
    teamIdIndex: index('team_id_idx').on(table.teamId),
    orgMemberIdIndex: index('org_member_id_idx').on(table.orgMemberId),
    orgMemberToTeamIndex: uniqueIndex('org_member_to_team_idx').on(
      table.teamId,
      table.orgMemberId
    )
  })
);

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id]
  }),
  orgMember: one(orgMembers, {
    fields: [teamMembers.orgMemberId],
    references: [orgMembers.id]
  }),
  orgMemberProfile: one(orgMemberProfiles, {
    fields: [teamMembers.orgMemberProfileId],
    references: [orgMemberProfiles.id]
  })
}));

//******************* */
//* Spaces tables

export const spaces = mysqlTable(
  'spaces',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    parentSpaceId: foreignKey('parent_space_id'),
    publicId: publicId('spaces', 'public_id').notNull(),
    shortcode: varchar('shortcode', { length: 64 }).notNull(),
    type: mysqlEnum('type', ['open', 'private']).notNull(),
    personalSpace: boolean('personal_space').notNull().default(false),
    convoPrefix: varchar('convo_prefix', { length: 8 }),
    inheritParentPermissions: boolean('inherit_parent_permissions')
      .notNull()
      .default(false),
    name: varchar('name', { length: 128 }).notNull(),
    icon: varchar('icon', { length: 32 }).notNull().default('squares-four'),
    color: mysqlEnum('color', [...uiColors]).notNull(),
    description: text('description'),
    avatarTimestamp: timestamp('avatar_timestamp'),
    createdByOrgMemberId: foreignKey('created_by_org_member_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    shortcodeIndex: index('shortcode_idx').on(table.shortcode),
    shortcodeOrgUniqueIndex: uniqueIndex('shortcode_org_unique_idx').on(
      table.shortcode,
      table.orgId
    ),
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);

export const spaceRelations = relations(spaces, ({ one, many }) => ({
  parentSpace: one(spaces, {
    fields: [spaces.parentSpaceId],
    references: [spaces.id],
    relationName: 'parent'
  }),
  org: one(orgs, {
    fields: [spaces.orgId],
    references: [orgs.id]
  }),
  createdByOrgMember: one(orgMembers, {
    fields: [spaces.createdByOrgMemberId],
    references: [orgMembers.id]
  }),
  personalSpaceOwner: one(orgMembers, {
    fields: [spaces.id],
    references: [orgMembers.personalSpaceId]
  }),
  subSpaces: many(spaces, { relationName: 'parent' }),
  members: many(spaceMembers),
  workflows: many(spaceWorkflows),
  tags: many(spaceTags)
}));

//* Space Members

export const spaceMembers = mysqlTable(
  'space_members',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('spaceMembers', 'public_id').notNull(),
    spaceId: foreignKey('space_id').notNull(),
    orgMemberId: foreignKey('org_member_id'),
    teamId: foreignKey('team_id'),
    role: mysqlEnum('role', [...spaceMemberRoleArray])
      .notNull()
      .default('member'),
    notifications: mysqlEnum('notifications', [...spaceMemberNotificationArray])
      .notNull()
      .default('active'),
    addedByOrgMemberId: foreignKey('added_by_org_member_id').notNull(),
    addedAt: timestamp('added_at')
      .notNull()
      .$defaultFn(() => new Date()),
    removedAt: timestamp('removed_at'),
    canCreate: boolean('can_create').notNull().default(true),
    canRead: boolean('can_read').notNull().default(true),
    canComment: boolean('can_comment').notNull().default(true),
    canReply: boolean('can_reply').notNull().default(true),
    canDelete: boolean('can_delete').notNull().default(true),
    canChangeWorkflow: boolean('can_change_workflow').notNull().default(true),
    canSetWorkflowToClosed: boolean('can_set_workflow_to_closed')
      .notNull()
      .default(true),
    canAddTags: boolean('can_add_tags').notNull().default(true),
    canMoveToAnotherSpace: boolean('can_move_to_another_space')
      .notNull()
      .default(true),
    canAddToAnotherSpace: boolean('can_add_to_another_space')
      .notNull()
      .default(true),
    canMergeConvos: boolean('can_merge').notNull().default(true),
    canAddParticipants: boolean('can_add_participants').notNull().default(true)
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    orgMemberIdIndex: index('org_member_id_idx').on(table.orgMemberId)
  })
);

export const spaceMemberRelations = relations(spaceMembers, ({ one }) => ({
  org: one(orgs, {
    fields: [spaceMembers.orgId],
    references: [orgs.id]
  }),
  space: one(spaces, {
    fields: [spaceMembers.spaceId],
    references: [spaces.id]
  }),
  team: one(teams, {
    fields: [spaceMembers.teamId],
    references: [teams.id]
  }),
  orgMember: one(orgMembers, {
    fields: [spaceMembers.orgMemberId],
    references: [orgMembers.id],
    relationName: 'member'
  }),
  addedByOrgMember: one(orgMembers, {
    fields: [spaceMembers.addedByOrgMemberId],
    references: [orgMembers.id],
    relationName: 'addedBy'
  })
}));

export const spaceWorkflows = mysqlTable(
  'space_workflows',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('spaceWorkflows', 'public_id').notNull(),
    spaceId: foreignKey('space_id').notNull(),
    type: mysqlEnum('type', [...spaceWorkflowTypeArray]).notNull(),
    order: tinyint('order', { unsigned: true }).notNull(),
    name: varchar('name', { length: 32 }).notNull(),
    color: mysqlEnum('color', [...uiColors]).notNull(),
    icon: varchar('icon', { length: 32 }).notNull().default('check'),
    description: text('description'),
    disabled: boolean('disabled').notNull().default(false),
    createdByOrgMemberId: foreignKey('created_by_org_member_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId)
  })
);

export const spaceWorkflowsRelations = relations(
  spaceWorkflows,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [spaceWorkflows.orgId],
      references: [orgs.id]
    }),
    space: one(spaces, {
      fields: [spaceWorkflows.spaceId],
      references: [spaces.id]
    }),
    createdByOrgMember: one(orgMembers, {
      fields: [spaceWorkflows.createdByOrgMemberId],
      references: [orgMembers.id]
    }),
    convoWorkflows: many(convoWorkflows)
  })
);

export const spaceTags = mysqlTable(
  'space_tags',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('spaceTags', 'public_id').notNull(),
    spaceId: foreignKey('space_id').notNull(),
    label: varchar('label', { length: 32 }).notNull(),
    description: text('description'),
    color: mysqlEnum('color', [...uiColors]).notNull(),
    icon: varchar('icon', { length: 32 }).notNull().default('tag-simple'),
    createdByOrgMemberId: foreignKey('created_by_org_member_id').notNull(),
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    createdByOrgMemberIdIndex: index('created_by_org_member_id_idx').on(
      table.createdByOrgMemberId
    )
  })
);

export const spaceTagsRelations = relations(spaceTags, ({ one, many }) => ({
  org: one(orgs, {
    fields: [spaceTags.orgId],
    references: [orgs.id]
  }),
  space: one(spaces, {
    fields: [spaceTags.spaceId],
    references: [spaces.id]
  }),
  createdByOrgMember: one(orgMembers, {
    fields: [spaceTags.createdByOrgMemberId],
    references: [orgMembers.id]
  }),
  convoTags: many(convoTags)
}));

//******************* */
//* Domains table
export const domains = mysqlTable(
  'domains',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    disabled: boolean('disabled').notNull().default(false),
    publicId: publicId('domains', 'public_id').notNull(),
    catchAllAddress: foreignKey('catch_all_address'),
    postalHost: varchar('postal_host', { length: 32 }).notNull(),
    domain: varchar('domain', { length: 256 }).notNull(),
    forwardingAddress: varchar('forwarding_address', { length: 128 }),
    postalId: varchar('postal_id', { length: 64 }),
    domainStatus: mysqlEnum('domain_status', [
      'unverified',
      'pending',
      'active',
      'disabled'
    ])
      .notNull()
      .default('unverified'),
    sendingMode: mysqlEnum('sending_mode', [
      'native',
      'external',
      'disabled'
    ]).notNull(),
    receivingMode: mysqlEnum('receiving_mode', [
      'native',
      'forwarding',
      'disabled'
    ]).notNull(),
    dkimKey: varchar('dkim_key', { length: 32 }),
    dkimValue: varchar('dkim_value', { length: 256 }),
    verificationToken: varchar('verification_token', { length: 64 }),
    mxDnsValid: boolean('mx_dns_valid').notNull().default(false),
    dkimDnsValid: boolean('dkim_dns_valid').notNull().default(false),
    spfDnsValid: boolean('spf_dns_valid').notNull().default(false),
    returnPathDnsValid: boolean('return_path_dns_valid')
      .notNull()
      .default(false),
    lastDnsCheckAt: timestamp('last_dns_check_at'),
    disabledAt: timestamp('disabled_at'),
    verifiedAt: timestamp('verified_at'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    domainNameIndex: index('domain_name_idx').on(table.domain),
    domainOrgIndex: uniqueIndex('domain_org_idx').on(table.domain, table.orgId),
    postalIdIndex: uniqueIndex('postal_id_idx').on(table.postalId)
  })
);
export const domainsRelations = relations(domains, ({ one }) => ({
  org: one(orgs, {
    fields: [domains.orgId],
    references: [orgs.id]
  }),
  postalConfig: one(orgPostalConfigs, {
    fields: [domains.postalHost],
    references: [orgPostalConfigs.id]
  }),
  catchAllAddress: one(emailIdentities, {
    fields: [domains.catchAllAddress],
    references: [emailIdentities.id]
  })
}));

//******************* */
//* Postal servers

export const postalServers = mysqlTable(
  'postal_servers',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('postalServers', 'public_id').notNull(),
    type: mysqlEnum('type', ['email', 'transactional', 'marketing']).notNull(),
    apiKey: varchar('api_key', { length: 64 }).notNull(),
    smtpKey: varchar('smtp_key', { length: 64 }),
    rootForwardingAddress: varchar('root_forwarding_address', { length: 128 })
  },
  (table) => ({
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit: when rootMailServer is true, type must be email
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit: when rootMailServer is false, smtpKey must not be null
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit: when rootMailServer is false, rootForwardingAddress must be null
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);
export const postalServersRelations = relations(postalServers, ({ one }) => ({
  org: one(orgs, {
    fields: [postalServers.orgId],
    references: [orgs.id]
  }),
  orgPostalConfigs: one(orgPostalConfigs, {
    fields: [postalServers.orgId],
    references: [orgPostalConfigs.orgId]
  })
}));

//******************* */
//* Contacts

// TODO: Add email generated column when supported in Drizzle-orm: https://github.com/drizzle-team/drizzle-orm/pull/1471

export const contacts = mysqlTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('contacts', 'public_id').notNull(),
    avatarTimestamp: timestamp('avatar_timestamp'),
    reputationId: foreignKey('reputation_id').notNull(),
    name: varchar('name', { length: 128 }),
    setName: varchar('set_name', { length: 128 }),
    emailUsername: varchar('email_username', { length: 128 }).notNull(),
    emailDomain: varchar('email_domain', { length: 128 }).notNull(),
    signaturePlainText: text('signature'),
    signatureHtml: text('signature_html'),
    type: mysqlEnum('type', [
      'person',
      'product',
      'newsletter',
      'marketing',
      'unknown'
    ]).notNull(),
    screenerStatus: mysqlEnum('screener_status', [
      'pending',
      'approve',
      'reject'
    ]),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    emailIndex: index('email_idx').on(table.emailUsername, table.emailDomain),
    emailOrgUniqueIndex: uniqueIndex('email_org_unique_idx').on(
      table.emailUsername,
      table.emailDomain,
      table.orgId
    )
  })
);

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  org: one(orgs, {
    fields: [contacts.orgId],
    references: [orgs.id]
  }),
  convoParticipants: many(convoParticipants),
  reputation: one(contactGlobalReputations, {
    fields: [contacts.reputationId],
    references: [contactGlobalReputations.id]
  })
}));

export const contactGlobalReputations = mysqlTable(
  'contact_global_reputations',
  // eslint-disable-next-line @u22n/custom/table-needs-org-id
  {
    id: serial('id').primaryKey(),
    emailAddress: varchar('email_address', { length: 128 }).notNull(),
    spam: tinyint('spam').notNull().default(0),
    cold: tinyint('cold').notNull().default(0),
    newsletter: tinyint('newsletter').notNull().default(0),
    marketing: tinyint('marketing').notNull().default(0),
    product: tinyint('product').notNull().default(0),
    messageCount: mediumint('message_count').notNull().default(0),
    lastUpdated: timestamp('last_updated')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    emailAddressIndex: uniqueIndex('email_address_idx').on(table.emailAddress)
  })
);

export const contactGlobalReputationsRelations = relations(
  contactGlobalReputations,
  ({ many }) => ({
    contacts: many(contacts)
  })
);

//******************* */
//* Email Identities

export const emailRoutingRules = mysqlTable(
  'email_routing_rules',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('emailRoutingRules', 'public_id').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    description: text('description'),
    createdBy: foreignKey('created_by').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId)
  })
);

export const emailRoutingRulesRelations = relations(
  emailRoutingRules,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [emailRoutingRules.orgId],
      references: [orgs.id]
    }),
    createdByOrgMember: one(orgMembers, {
      fields: [emailRoutingRules.createdBy],
      references: [orgMembers.id]
    }),
    mailIdentities: many(emailIdentities),
    destinations: many(emailRoutingRulesDestinations)
  })
);

export const emailRoutingRulesDestinations = mysqlTable(
  'email_routing_rules_destinations',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('emailRoutingRuleDestinations', 'public_id').notNull(),
    ruleId: foreignKey('rule_id').notNull(),
    teamId: foreignKey('team_id'), //! DELETE AFTER MIGRATION TO SPACES SUCCESS
    orgMemberId: foreignKey('org_member_id'), //! DELETE AFTER MIGRATION TO SPACES SUCCESS
    spaceId: foreignKey('space_id'), //! Set to NOT NULL after migration to spaces is complete
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    ruleIdIndex: index('rule_id_idx').on(table.ruleId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    teamIdIndex: index('team_id_idx').on(table.teamId), //! DELETE AFTER MIGRATION TO SPACES SUCCESS
    orgMemberIdIndex: index('org_member_id_idx').on(table.orgMemberId) //! DELETE AFTER MIGRATION TO SPACES SUCCESS
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit : orgMemberId//teamId//spaceId
  })
);
export const emailRoutingRulesDestinationsRelations = relations(
  emailRoutingRulesDestinations,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [emailRoutingRulesDestinations.orgId],
      references: [orgs.id]
    }),
    rule: one(emailRoutingRules, {
      fields: [emailRoutingRulesDestinations.ruleId],
      references: [emailRoutingRules.id]
    }),
    team: one(teams, {
      fields: [emailRoutingRulesDestinations.teamId],
      references: [teams.id]
    }),
    orgMember: one(orgMembers, {
      fields: [emailRoutingRulesDestinations.orgMemberId],
      references: [orgMembers.id]
    }),
    space: one(spaces, {
      fields: [emailRoutingRulesDestinations.spaceId],
      references: [spaces.id]
    }),
    assignees: many(emailRoutingRuleAssignees)
  })
);

export const emailRoutingRuleAssignees = mysqlTable(
  'email_routing_rule_assignees',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    ruleDestinationId: foreignKey('rule_destination_id').notNull(),
    orgMemberId: foreignKey('org_member_id').notNull(),
    teamId: foreignKey('team_id'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    ruleDestinationId: index('rule_destination_id_idx').on(
      table.ruleDestinationId
    ),
    orgId: index('org_id_idx').on(table.orgId),
    orgMemberId: index('org_member_id_idx').on(table.orgMemberId),
    teamId: index('team_id_idx').on(table.teamId)
  })
);

export const emailRoutingRuleAssigneesRelations = relations(
  emailRoutingRuleAssignees,
  ({ one }) => ({
    ruleDestination: one(emailRoutingRulesDestinations, {
      fields: [emailRoutingRuleAssignees.ruleDestinationId],
      references: [emailRoutingRulesDestinations.id]
    }),
    orgMember: one(orgMembers, {
      fields: [emailRoutingRuleAssignees.orgMemberId],
      references: [orgMembers.id]
    }),
    team: one(teams, {
      fields: [emailRoutingRuleAssignees.teamId],
      references: [teams.id]
    })
  })
);

export const emailIdentities = mysqlTable(
  'email_identities',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('emailIdentities', 'public_id').notNull(),
    username: varchar('username', { length: 32 }).notNull(),
    domainName: varchar('domain_name', { length: 128 }).notNull(),
    domainId: foreignKey('domain_id'),
    routingRuleId: foreignKey('routing_rule_id').notNull(),
    sendName: varchar('send_name', { length: 128 }),
    createdBy: foreignKey('created_by').notNull(),
    isCatchAll: boolean('is_catch_all').notNull().default(false),
    personalEmailIdentityId: foreignKey('personal_email_identity_id'),
    externalCredentialsId: foreignKey('external_credentials_id'),
    forwardingAddress: varchar('forwarding_address', { length: 128 }),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit : !domainId && !catchAll - cant be catchall on root domains || catchAll && domainId - Single domain can only have one catch all email address
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    domainIdIndex: index('domain_id_idx').on(table.domainId),
    domainNameIndex: index('domain_id_idx').on(table.domainName),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    emailIndex: uniqueIndex('email_idx').on(table.username, table.domainName)
  })
);

export const emailIdentitiesRelations = relations(
  emailIdentities,
  ({ one, many }) => ({
    createdBy: one(orgMembers, {
      fields: [emailIdentities.createdBy],
      references: [orgMembers.id]
    }),
    org: one(orgs, {
      fields: [emailIdentities.orgId],
      references: [orgs.id]
    }),
    domain: one(domains, {
      fields: [emailIdentities.domainId],
      references: [domains.id]
    }),
    authorizedSenders: many(emailIdentitiesAuthorizedSenders),
    routingRules: one(emailRoutingRules, {
      fields: [emailIdentities.routingRuleId],
      references: [emailRoutingRules.id]
    }),
    externalCredentials: one(emailIdentityExternal, {
      fields: [emailIdentities.externalCredentialsId],
      references: [emailIdentityExternal.id]
    })
  })
);

export const emailIdentitiesAuthorizedSenders = mysqlTable(
  'email_identities_authorized_org_members',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    identityId: foreignKey('identity_id').notNull(),
    orgMemberId: foreignKey('org_member_id'),
    teamId: foreignKey('team_id'),
    // default: boolean('default').notNull().default(false),
    spaceId: foreignKey('space_id'),
    addedBy: foreignKey('added_by').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit : orgMemberId//teamId, orgMemberId//default, teamId//default
    orgIdIndex: index('org_id_idx').on(table.orgId),
    identityIdIndex: index('identity_id_idx').on(table.identityId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    orgMemberToIdentityIndex: uniqueIndex('org_member_to_identity_idx').on(
      table.identityId,
      table.orgMemberId
    ),
    teamToIdentityIndex: uniqueIndex('team_to_identity_idx').on(
      table.identityId,
      table.teamId
    )
  })
);

export const emailIdentitiesAuthorizedOrgMemberRelations = relations(
  emailIdentitiesAuthorizedSenders,
  ({ one }) => ({
    org: one(orgs, {
      fields: [emailIdentitiesAuthorizedSenders.orgId],
      references: [orgs.id]
    }),
    emailIdentity: one(emailIdentities, {
      fields: [emailIdentitiesAuthorizedSenders.identityId],
      references: [emailIdentities.id]
    }),
    orgMember: one(orgMembers, {
      fields: [emailIdentitiesAuthorizedSenders.orgMemberId],
      references: [orgMembers.id]
    }),
    team: one(teams, {
      fields: [emailIdentitiesAuthorizedSenders.teamId],
      references: [teams.id]
    }),
    space: one(spaces, {
      fields: [emailIdentitiesAuthorizedSenders.spaceId],
      references: [spaces.id]
    })
  })
);

export const emailIdentitiesPersonal = mysqlTable(
  'email_identities_personal',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('emailIdentitiesPersonal', 'public_id').notNull(),
    accountId: foreignKey('account_id').notNull(),
    emailIdentityId: foreignKey('email_identity_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    accountIdIndex: index('account_id_idx').on(table.accountId),
    orgIdIndex: index('org_id_idx').on(table.orgId),
    emailIdentityIdIndex: index('email_identity_id_idx').on(
      table.emailIdentityId
    )
  })
);

export const emailIdentitiesPersonalRelations = relations(
  emailIdentitiesPersonal,
  ({ one }) => ({
    account: one(accounts, {
      fields: [emailIdentitiesPersonal.accountId],
      references: [accounts.id]
    }),
    org: one(orgs, {
      fields: [emailIdentitiesPersonal.orgId],
      references: [orgs.id]
    }),
    emailIdentity: one(emailIdentities, {
      fields: [emailIdentitiesPersonal.emailIdentityId],
      references: [emailIdentities.id]
    })
  })
);

export const emailIdentityExternal = mysqlTable(
  'email_identity_external',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('emailIdentitiesExternal', 'public_id').notNull(),
    nickname: varchar('nickname', { length: 128 }).notNull(),
    createdBy: foreignKey('created_by').notNull(),
    username: varchar('username', {
      length: 128
    }).notNull(),
    password: varchar('password', {
      length: 128
    }).notNull(),
    host: varchar('hostname', { length: 128 }).notNull(),
    port: smallint('port').notNull(),
    authMethod: mysqlEnum('auth_method', ['plain', 'login']).notNull(), // No support for CRAM_MD5 yet, does it even gets used?
    encryption: mysqlEnum('encryption', ['ssl', 'tls', 'starttls', 'none'])
      .default('none')
      .notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);
export const emailIdentityExternalRelations = relations(
  emailIdentityExternal,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [emailIdentityExternal.orgId],
      references: [orgs.id]
    }),
    createdBy: one(orgMembers, {
      fields: [emailIdentityExternal.createdBy],
      references: [orgMembers.id]
    }),
    emailIdentities: many(emailIdentities)
  })
);

//******************* */
//* conversation tables

export const convos = mysqlTable(
  'convos',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convos', 'public_id').notNull(),
    lastUpdatedAt: timestamp('last_updated_at').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    createdAtIndex: index('created_at_idx').on(table.createdAt)
  })
);
export const convosRelations = relations(convos, ({ one, many }) => ({
  org: one(orgs, {
    fields: [convos.orgId],
    references: [orgs.id]
  }),
  participants: many(convoParticipants),
  attachments: many(convoAttachments),
  entries: many(convoEntries),
  subjects: many(convoSubjects),
  seen: many(convoSeenTimestamps),
  spaces: many(convoToSpaces),
  workflows: many(convoWorkflows),
  tags: many(convoTags)
}));

export const convoToSpaces = mysqlTable(
  'convo_to_spaces',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoToSpaces', 'public_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    spaceId: foreignKey('space_id').notNull()
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId)
  })
);

export const convoToSpacesRelations = relations(
  convoToSpaces,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [convoToSpaces.orgId],
      references: [orgs.id]
    }),
    convo: one(convos, {
      fields: [convoToSpaces.convoId],
      references: [convos.id]
    }),
    space: one(spaces, {
      fields: [convoToSpaces.spaceId],
      references: [spaces.id]
    }),
    workflows: many(convoWorkflows),
    tags: many(convoTags)
  })
);

export const convoWorkflows = mysqlTable(
  'convo_workflows',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoWorkflows', 'public_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    spaceId: foreignKey('space_id').notNull(),
    convoToSpaceId: foreignKey('convo_to_space_id').notNull(),
    workflow: foreignKey('workflow_id'),
    byOrgMemberId: foreignKey('by_org_member_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    convoToSpacesIdIndex: index('convo_to_spaces_id_idx').on(
      table.convoToSpaceId
    ),
    workflowIndex: index('workflow_idx').on(table.workflow)
  })
);

export const convoWorkflowsRelations = relations(convoWorkflows, ({ one }) => ({
  org: one(orgs, {
    fields: [convoWorkflows.orgId],
    references: [orgs.id]
  }),
  convo: one(convos, {
    fields: [convoWorkflows.convoId],
    references: [convos.id]
  }),
  space: one(spaces, {
    fields: [convoWorkflows.spaceId],
    references: [spaces.id]
  }),
  convoToSpace: one(convoToSpaces, {
    fields: [convoWorkflows.convoToSpaceId],
    references: [convoToSpaces.id]
  }),
  workflow: one(spaceWorkflows, {
    fields: [convoWorkflows.workflow],
    references: [spaceWorkflows.id]
  }),
  byOrgMember: one(orgMembers, {
    fields: [convoWorkflows.byOrgMemberId],
    references: [orgMembers.id]
  })
}));

export const convoTags = mysqlTable(
  'convo_tags',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoTags', 'public_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    spaceId: foreignKey('space_id').notNull(),
    convoToSpaceId: foreignKey('convo_to_space_id').notNull(),
    tagId: foreignKey('tag_id').notNull(),
    addedByOrgMemberId: foreignKey('added_by_org_member_id').notNull(),
    addedAt: timestamp('added_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    spaceIdIndex: index('space_id_idx').on(table.spaceId),
    convoToSpacesIdIndex: index('convo_to_spaces_id_idx').on(
      table.convoToSpaceId
    ),
    tagIndex: index('tag_idx').on(table.tagId)
  })
);

export const convoTagsRelations = relations(convoTags, ({ one }) => ({
  org: one(orgs, {
    fields: [convoTags.orgId],
    references: [orgs.id]
  }),
  convo: one(convos, {
    fields: [convoTags.convoId],
    references: [convos.id]
  }),
  space: one(spaces, {
    fields: [convoTags.spaceId],
    references: [spaces.id]
  }),
  convoToSpace: one(convoToSpaces, {
    fields: [convoTags.convoToSpaceId],
    references: [convoToSpaces.id]
  }),
  tag: one(spaceTags, {
    fields: [convoTags.tagId],
    references: [spaceTags.id]
  }),
  addedByOrgMember: one(orgMembers, {
    fields: [convoTags.addedByOrgMemberId],
    references: [orgMembers.id]
  })
}));

export const convoSubjects = mysqlTable(
  'convo_subjects',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoSubjects', 'public_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    subject: varchar('subject', { length: 256 }).notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    convoIdIndex: index('convo_id_idx').on(table.convoId)
  })
);
export const convoSubjectsRelations = relations(convoSubjects, ({ one }) => ({
  org: one(orgs, {
    fields: [convoSubjects.orgId],
    references: [orgs.id]
  }),
  convo: one(convos, {
    fields: [convoSubjects.convoId],
    references: [convos.id]
  })
}));

export const convoParticipants = mysqlTable(
  'convo_participants',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoParticipants', 'public_id').notNull(),
    orgMemberId: foreignKey('org_member_id'),
    teamId: foreignKey('team_id'),
    contactId: foreignKey('contact_id'),
    convoId: foreignKey('convo_id').notNull(),
    role: mysqlEnum('role', [
      'assigned',
      'contributor',
      'commenter',
      'watcher',
      'teamMember',
      'guest'
    ]) // Assigned/Contributor will be added to email CCs - other roles will not
      .notNull()
      .default('contributor'),
    emailIdentityId: foreignKey('email_identity_id'),
    notifications: mysqlEnum('notifications', ['active', 'muted', 'off'])
      .notNull()
      .default('active'),
    lastReadAt: timestamp('last_read_at'),
    active: boolean('active').notNull().default(true),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    //TODO: add support for Check constraints when implemented in drizzle-orm & drizzle-kit : orgMemberId//teamId
    orgIdIndex: index('org_id_idx').on(table.orgId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgMemberIdIndex: index('org_member_id_idx').on(table.orgMemberId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    orgMemberToConvoIndex: index('org_member_to_convo_idx').on(
      table.convoId,
      table.orgMemberId
    ),
    teamToConvoIndex: uniqueIndex('team_to_convo_idx').on(
      table.convoId,
      table.teamId
    )
  })
);
export const convoParticipantsRelations = relations(
  convoParticipants,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [convoParticipants.orgId],
      references: [orgs.id]
    }),
    orgMember: one(orgMembers, {
      fields: [convoParticipants.orgMemberId],
      references: [orgMembers.id]
    }),
    team: one(teams, {
      fields: [convoParticipants.teamId],
      references: [teams.id]
    }),
    contact: one(contacts, {
      fields: [convoParticipants.contactId],
      references: [contacts.id]
    }),
    convo: one(convos, {
      fields: [convoParticipants.convoId],
      references: [convos.id]
    }),
    seen: many(convoSeenTimestamps),
    teamMemberships: many(convoParticipantTeamMembers, {
      relationName: 'memberships'
    }),
    teamMembers: many(convoParticipantTeamMembers, { relationName: 'team' }),
    emailIdentity: one(emailIdentities, {
      fields: [convoParticipants.emailIdentityId],
      references: [emailIdentities.id]
    })
  })
);

export const convoParticipantTeamMembers = mysqlTable(
  'convo_participant_team_members',
  {
    id: serial('id'), // -> removed pk from here
    orgId: foreignKey('org_id').notNull(),
    convoParticipantId: foreignKey('convo_participant_id').notNull(),
    teamId: foreignKey('team_id').notNull()
  },
  (table) => ({
    // moved pk here
    pk: primaryKey({
      columns: [table.id],
      name: 'convo_participant_team_members_id'
    }),
    convoParticipantIdIndex: index('convo_participant_id_idx').on(
      table.convoParticipantId
    ),
    teamIdIndex: index('team_id_idx').on(table.teamId)
  })
);

export const convoParticipantTeamMembersRelations = relations(
  convoParticipantTeamMembers,
  ({ one }) => ({
    convoParticipant: one(convoParticipants, {
      fields: [convoParticipantTeamMembers.convoParticipantId],
      references: [convoParticipants.id],
      relationName: 'memberships'
    }),
    team: one(convoParticipants, {
      fields: [convoParticipantTeamMembers.teamId],
      references: [convoParticipants.teamId],
      relationName: 'team'
    })
  })
);

export const convoAttachments = mysqlTable(
  'convo_attachments',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoAttachments', 'public_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    convoEntryId: foreignKey('convo_entry_id'),
    fileName: varchar('fileName', { length: 256 }).notNull(),
    type: varchar('type', { length: 256 }).notNull(),
    size: int('size', { unsigned: true }).notNull(),
    inline: boolean('inline').notNull().default(false),
    public: boolean('public').notNull().default(false),
    convoParticipantId: foreignKey('convo_participant_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    convoEntryIdIndex: index('convo_entry_id_idx').on(table.convoEntryId),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId)
  })
);
export const convoAttachmentsRelations = relations(
  convoAttachments,
  ({ one }) => ({
    org: one(orgs, {
      fields: [convoAttachments.orgId],
      references: [orgs.id]
    }),
    convo: one(convos, {
      fields: [convoAttachments.convoId],
      references: [convos.id]
    }),
    convoEntry: one(convoEntries, {
      fields: [convoAttachments.convoEntryId],
      references: [convoEntries.id]
    }),
    uploader: one(convoParticipants, {
      fields: [convoAttachments.convoParticipantId],
      references: [convoParticipants.id]
    })
  })
);
// Pending Attachments

export const pendingAttachments = mysqlTable(
  'pending_attachments',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoAttachments', 'public_id').notNull(),
    orgPublicId: publicId('org', 'org_public_id').notNull(),
    filename: varchar('filename', { length: 256 }).notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    orgIdIndex: index('org_id_idx').on(table.orgId)
  })
);

export const pendingAttachmentsRelations = relations(
  pendingAttachments,
  ({ one }) => ({
    org: one(orgs, {
      fields: [pendingAttachments.orgId],
      references: [orgs.id]
    })
  })
);

export type ConvoEntryMetadataEmailAddress = {
  id: number;
  publicId: string;
  type: 'contact' | 'emailIdentity';
  email: string;
};

export type ConvoEntryMetadataMissingParticipant = {
  type: 'user' | 'team';
  publicId: string;
  name: string;
};

export type ConvoEntryMetadataEmail = {
  messageId: string;
  to: ConvoEntryMetadataEmailAddress[];
  from: ConvoEntryMetadataEmailAddress[];
  cc: ConvoEntryMetadataEmailAddress[];
  postalMessages: {
    recipient: string;
    id: number;
    token: string;
    postalMessageId: string | null;
  }[];
  emailHeaders?: string;
  missingParticipants?: ConvoEntryMetadataMissingParticipant[];
};
export type ConvoEntryMetadata = {
  email?: ConvoEntryMetadataEmail;
};

export const convoEntries = mysqlTable(
  'convo_entries',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    publicId: publicId('convoEntries', 'public_id').notNull(),
    type: mysqlEnum('type', ['message', 'comment', 'draft']).notNull(),
    convoId: foreignKey('convo_id').notNull(),
    subjectId: foreignKey('subject_id'),
    author: foreignKey('author').notNull(),
    replyToId: foreignKey('reply_to_id'),
    body: json('body').notNull(),
    bodyPlainText: longtext('body_plain_text').notNull(),
    bodyCleanedHtml: longtext('body_cleaned_html'),
    metadata: json('metadata').$type<ConvoEntryMetadata>().default({}),
    emailMessageId: varchar('email_message_id', {
      length: 255
    }).generatedAlwaysAs(sql`JSON_UNQUOTE(metadata-> '$.email.messageId')`, {
      mode: 'stored'
    }),
    visibility: mysqlEnum('visibility', [
      'private',
      'internal_participants',
      'org',
      'all_participants'
    ]).notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    convoIdIndex: index('convo_id_idx').on(table.convoId),
    subjectIdIndex: index('subject_id_idx').on(table.subjectId),
    authorIndex: index('author_idx').on(table.author),
    publicIdIndex: uniqueIndex('public_id_idx').on(table.publicId),
    typeIndex: index('type_idx').on(table.type),
    replyToIdIndex: index('reply_to_id_idx').on(table.replyToId),
    createdAtIndex: index('created_at_idx').on(table.createdAt),
    emailMessageIdIndex: index('email_message_id_idx').on(table.emailMessageId)
  })
);

export const convoEntriesRelations = relations(
  convoEntries,
  ({ one, many }) => ({
    org: one(orgs, {
      fields: [convoEntries.orgId],
      references: [orgs.id]
    }),
    convo: one(convos, {
      fields: [convoEntries.convoId],
      references: [convos.id]
    }),
    subject: one(convoSubjects, {
      fields: [convoEntries.subjectId],
      references: [convoSubjects.id]
    }),
    author: one(convoParticipants, {
      fields: [convoEntries.author],
      references: [convoParticipants.id]
    }),
    attachments: many(convoAttachments),
    replies: many(convoEntryReplies, {
      relationName: 'replies'
    }),
    replyTo: one(convoEntryReplies, {
      fields: [convoEntries.replyToId],
      references: [convoEntryReplies.entrySourceId],
      relationName: 'inReplyTo'
    }),
    seenBy: many(convoEntrySeenTimestamps),
    rawHtml: one(convoEntryRawHtmlEmails, {
      fields: [convoEntries.id],
      references: [convoEntryRawHtmlEmails.entryId]
    })
  })
);

export const convoEntryReplies = mysqlTable(
  'convo_entry_replies',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    entrySourceId: foreignKey('convo_message_source_id').notNull(),
    entryReplyId: foreignKey('convo_message_reply_id'),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    entrySourceIdIndex: index('entry_source_id_idx').on(table.entrySourceId),
    entryReplyIdIndex: index('entry_reply_id_idx').on(table.entryReplyId),
    createdAtIndex: index('created_at_idx').on(table.createdAt)
  })
);

export const convoEntryRepliesRelations = relations(
  convoEntryReplies,
  ({ one }) => ({
    convoMessageSource: one(convoEntries, {
      fields: [convoEntryReplies.entrySourceId],
      references: [convoEntries.id],
      relationName: 'inReplyTo'
    }),
    convoMessageReply: one(convoEntries, {
      fields: [convoEntryReplies.entryReplyId],
      references: [convoEntries.id],
      relationName: 'replies'
    })
  })
);

export const convoEntryPrivateVisibilityParticipants = mysqlTable(
  'convo_entry_private_visibility_participants',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    entryId: foreignKey('entry_id').notNull(),
    convoMemberId: foreignKey('convo_member_id').notNull(),
    createdAt: timestamp('created_at')
      .notNull()
      .$defaultFn(() => new Date())
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    entryIdIndex: index('entry_id_idx').on(table.entryId),
    convoMemberIdIndex: index('convo_member_id_idx').on(table.convoMemberId)
  })
);

export const convoEntryPrivateVisibilityParticipantsRelations = relations(
  convoEntryPrivateVisibilityParticipants,
  ({ one }) => ({
    convoEntry: one(convoEntries, {
      fields: [convoEntryPrivateVisibilityParticipants.entryId],
      references: [convoEntries.id]
    }),
    convoMember: one(convoParticipants, {
      fields: [convoEntryPrivateVisibilityParticipants.convoMemberId],
      references: [convoParticipants.id]
    })
  })
);

export const convoEntryRawHtmlEmails = mysqlTable(
  'convo_entry_raw_html_emails',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    entryId: foreignKey('entry_id').notNull(),
    headers: json('headers').notNull(),
    html: mediumtext('html').notNull(),
    wipeDate: timestamp('wipe_date').notNull(),
    keep: boolean('keep').notNull().default(false),
    wiped: boolean('wiped').notNull().default(false)
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    entryIdIndex: index('entry_id_idx').on(table.entryId),
    wipeDateIndex: index('wipe_date_idx').on(table.wipeDate)
  })
);

export const convoEntryRawHtmlEmailsRelations = relations(
  convoEntryRawHtmlEmails,
  ({ one }) => ({
    convoEntry: one(convoEntries, {
      fields: [convoEntryRawHtmlEmails.entryId],
      references: [convoEntries.id]
    }),
    org: one(orgs, {
      fields: [convoEntryRawHtmlEmails.orgId],
      references: [orgs.id]
    })
  })
);

// timestamps
export const convoSeenTimestamps = mysqlTable(
  'convo_seen_timestamps',
  {
    orgId: foreignKey('org_id').notNull(),
    convoId: foreignKey('convo_id').notNull(),
    participantId: foreignKey('participant_id').notNull(),
    orgMemberId: foreignKey('org_member_id').notNull(),
    seenAt: timestamp('seen_at').notNull()
  },
  (table) => {
    return {
      id: primaryKey({
        name: 'id',
        columns: [table.convoId, table.participantId, table.orgMemberId]
      }),
      convoIdIndex: index('convo_id_idx').on(table.convoId),
      seenAt: index('seen_at_idx').on(table.seenAt),
      participantIdIndex: index('participant_id_idx').on(table.participantId)
    };
  }
);

export const convoSeenTimestampsRelations = relations(
  convoSeenTimestamps,
  ({ one }) => ({
    convo: one(convos, {
      fields: [convoSeenTimestamps.convoId],
      references: [convos.id]
    }),
    participant: one(convoParticipants, {
      fields: [convoSeenTimestamps.participantId],
      references: [convoParticipants.id]
    }),
    orgMember: one(orgMembers, {
      fields: [convoSeenTimestamps.orgMemberId],
      references: [orgMembers.id]
    })
  })
);

export const convoEntrySeenTimestamps = mysqlTable(
  'convo_entry_seen_timestamps',
  {
    orgId: foreignKey('org_id').notNull(),
    convoEntryId: foreignKey('convo_entry_id').notNull(),
    participantId: foreignKey('participant_id').notNull(),
    orgMemberId: foreignKey('org_member_id').notNull(),
    seenAt: timestamp('seen_at').notNull()
  },
  (table) => {
    return {
      id: primaryKey({
        name: 'id',
        columns: [table.convoEntryId, table.participantId, table.orgMemberId]
      }),
      convoEntryIdIndex: index('convo_entry_id_idx').on(table.convoEntryId),
      participantIdIndex: index('participant_id_idx').on(table.participantId),
      seenAt: index('seen_at_idx').on(table.seenAt)
    };
  }
);

export const convoEntrySeenTimestampsRelations = relations(
  convoEntrySeenTimestamps,
  ({ one }) => ({
    convoEntry: one(convoEntries, {
      fields: [convoEntrySeenTimestamps.convoEntryId],
      references: [convoEntries.id]
    }),
    participant: one(convoParticipants, {
      fields: [convoEntrySeenTimestamps.participantId],
      references: [convoParticipants.id]
    }),
    orgMember: one(orgMembers, {
      fields: [convoEntrySeenTimestamps.orgMemberId],
      references: [orgMembers.id]
    })
  })
);

// Billing Tables - only used in EE packages

export const orgBilling = mysqlTable(
  'org_billing',
  {
    id: serial('id').primaryKey(),
    orgId: foreignKey('org_id').notNull(),
    stripeCustomerId: varchar('stripe_customer_id', { length: 128 }).notNull(),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 128 }),
    plan: mysqlEnum('plan', [...stripePlanNames])
      .notNull()
      .default('starter'),
    period: mysqlEnum('period', [...stripeBillingPeriods])
      .notNull()
      .default('monthly')
  },
  (table) => ({
    orgIdIndex: index('org_id_idx').on(table.orgId),
    stripeCustomerIdIndex: uniqueIndex('stripe_customer_id_idx').on(
      table.stripeCustomerId
    ),
    stripeSubscriptionIdIndex: uniqueIndex('stripe_subscription_id_idx').on(
      table.stripeSubscriptionId
    )
  })
);

export const orgBillingRelations = relations(orgBilling, ({ one }) => ({
  org: one(orgs, {
    fields: [orgBilling.orgId],
    references: [orgs.id]
  })
}));
