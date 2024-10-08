'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/src/components/shadcn-ui/tooltip';
import { EditableText } from '@/src/components/shared/editable-text';
import { Button } from '@/src/components/shadcn-ui/button';
import { IdentificationCard } from '@phosphor-icons/react';
import { Input } from '@/src/components/shadcn-ui/input';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import { platform } from '@/src/lib/trpc';
import { cn } from '@/src/lib/utils';
import { env } from '@/src/env';
import { toast } from 'sonner';
import { z } from 'zod';

export function CreateOrg() {
  const [orgName, setOrgName] = useState('');
  const [orgShortcode, setOrgShortcode] = useState('');
  const [customShortcode, setCustomShortcode] = useState(false);
  const router = useRouter();
  const [debouncedOrgName] = useDebounce(orgName, 750);

  const [shortcodeValid, shortcodeError] = useMemo(() => {
    const { success, error } = z
      .string()
      .min(5)
      .max(64)
      .regex(/^[a-z0-9]*$/, {
        message: 'Only lowercase letters and numbers'
      })
      .safeParse(orgShortcode);
    return [
      success,
      error ? new Error(error.issues.map((i) => i.message).join(', ')) : null
    ];
  }, [orgShortcode]);

  const { data, isLoading, error } =
    platform.org.crud.checkShortcodeAvailability.useQuery(
      {
        shortcode: orgShortcode
      },
      {
        enabled: shortcodeValid && customShortcode
      }
    );

  const { data: generateShortcodeData, error: generateShortcodeError } =
    platform.org.crud.generateOrgShortcode.useQuery(
      {
        orgName: debouncedOrgName
      },
      {
        enabled: !customShortcode && debouncedOrgName.trim().length >= 5
      }
    );

  const utils = platform.useUtils();
  const generateOrgShortcodeUtils = utils.org.crud.generateOrgShortcode;

  // Update the shortcode if the org name changes
  useEffect(() => {
    if (generateShortcodeData) setOrgShortcode(generateShortcodeData.shortcode);
  }, [generateShortcodeData]);

  // If org name is less than 5 characters, clear the shortcode as min length is 5
  useEffect(() => {
    if (debouncedOrgName.trim().length < 5 && !customShortcode) {
      void generateOrgShortcodeUtils.invalidate();
      setOrgShortcode('');
    }
  }, [
    debouncedOrgName,
    customShortcode,
    orgShortcode,
    generateOrgShortcodeUtils
  ]);

  // handle shortcode generation error
  useEffect(() => {
    if (generateShortcodeError) {
      toast.error('An Error Occurred while generating the Org Shortcode', {
        description: generateShortcodeError.message
      });
      setOrgShortcode(debouncedOrgName.toLowerCase().replace(/[^a-z0-9]/g, ''));
      setCustomShortcode(true);
    }
  }, [debouncedOrgName, generateShortcodeError]);

  const { mutate: createOrg, isPending } =
    platform.org.crud.createNewOrg.useMutation({
      onSuccess: async () => {
        await utils.org.crud.getAccountOrgs.invalidate();
        await utils.account.profile.getOrgMemberProfile.invalidate();
        router.push(`/join/profile?org=${orgShortcode}`);
      }
    });

  return (
    <div className="flex w-full flex-col gap-1">
      <Input
        label="Organization Name"
        fullWidth
        inputSize="lg"
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        leadingSlot={IdentificationCard}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="text-base-11 w-fit text-xs">
            {env.NEXT_PUBLIC_WEBAPP_URL}/
            <EditableText
              value={orgShortcode}
              setValue={(value) => {
                setOrgShortcode(value);
                setCustomShortcode(true);
              }}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent>Click to Edit</TooltipContent>
      </Tooltip>
      <div
        className={cn(
          'text-xs',
          data && (!data?.available ? 'text-red-10' : 'text-green-10'),
          !shortcodeValid && !isLoading && 'text-red-10'
        )}>
        {orgShortcode.length > 0 && !shortcodeValid
          ? shortcodeError?.message
          : isLoading
            ? 'Checking availability...'
            : error
              ? error.message
              : data
                ? data.available
                  ? 'Looks good!'
                  : (data?.error ?? 'Shortcode is not available')
                : ''}
      </div>
      <Button
        disabled={
          !orgName ||
          !shortcodeValid ||
          (customShortcode && !data?.available) ||
          isLoading
        }
        loading={isPending}
        onClick={() => {
          if (
            !orgName ||
            !shortcodeValid ||
            (customShortcode && !data?.available) ||
            isLoading
          )
            return;
          createOrg({ orgName, orgShortcode });
        }}>
        Create Organization
      </Button>
    </div>
  );
}
