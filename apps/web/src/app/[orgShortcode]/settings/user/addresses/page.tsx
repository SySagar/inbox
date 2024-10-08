'use client';

import { ClaimAddressModal } from './_components/claim-address-modal';
import { Skeleton } from '@/src/components/shadcn-ui/skeleton';
import { Button } from '@/src/components/shadcn-ui/button';
import { DataTable } from '@/src/components/shared/table';
import { PageTitle } from '../../_components/page-title';
import { useOrgShortcode } from '@/src/hooks/use-params';
import { columns } from './_components/columns';
import { platform } from '@/src/lib/trpc';
import { useState } from 'react';

export default function Page() {
  const orgShortcode = useOrgShortcode();
  const [claimAddressValue, setClaimAddressValue] = useState<string | null>(
    null
  );

  const { data: hasBilling } = platform.org.iCanHaz.billing.useQuery({
    orgShortcode
  });

  const { data: proStatus } = platform.org.setup.billing.isPro.useQuery(
    {
      orgShortcode
    },
    {
      enabled: hasBilling === true
    }
  );

  const { data: orgMember } =
    platform.account.profile.getOrgMemberProfile.useQuery({
      orgShortcode
    });
  const {
    data: personalAddresses,
    isLoading: personalAddressesLoading,
    error: personalAddressesError
  } = platform.account.addresses.getPersonalAddresses.useQuery();

  return (
    <div className="flex w-full flex-col gap-4 p-4">
      <PageTitle title="Your Addresses" />

      {personalAddressesLoading && <Skeleton className="h-10 w-full" />}

      {personalAddressesError && (
        <div className="flex flex-col gap-2 px-2">
          <span className="text-red-10 text-sm">
            An error occurred while fetching addresses.
          </span>
          {personalAddressesError?.message}
        </div>
      )}

      {personalAddresses && personalAddresses.available.free.length > 0 && (
        <div className="flex flex-col gap-2 px-2">
          <span>Available Free Addresses</span>
          {personalAddresses.available.free.map((domain) => (
            <div
              className="flex flex-row items-center justify-between gap-2"
              key={domain}>
              <span className="font-mono">
                {orgMember?.account?.username}@{domain}
              </span>
              <Button
                variant="default"
                onClick={() =>
                  setClaimAddressValue(
                    `${orgMember?.account?.username}@${domain}`
                  )
                }>
                Claim
              </Button>
            </div>
          ))}
        </div>
      )}

      {personalAddresses && personalAddresses.available.premium.length > 0 && (
        <div className="flex flex-col gap-2 px-2">
          <span>
            Available Premium Addresses{' '}
            <span className="text-base-11 text-sm">
              (with a pro subscription)
            </span>
          </span>

          {personalAddresses.available.premium.map((domain) => (
            <div
              className="flex flex-row items-center justify-between gap-2"
              key={domain}>
              <span className="font-mono">
                {orgMember?.account?.username}@{domain}
              </span>
              <Button
                onClick={() =>
                  setClaimAddressValue(
                    `${orgMember?.account?.username}@${domain}`
                  )
                }
                disabled={
                  hasBilling === true
                    ? !proStatus?.isPro && !personalAddresses.hasUninBonus
                    : false
                }>
                Claim
              </Button>
            </div>
          ))}
        </div>
      )}

      {personalAddresses && personalAddresses.identities.length > 0 && (
        <>
          <span>Your claimed addresses</span>
          <DataTable
            columns={columns}
            data={personalAddresses.identities}
          />
        </>
      )}

      {claimAddressValue && (
        <ClaimAddressModal
          address={claimAddressValue}
          setOpen={(open) => {
            if (!open) {
              setClaimAddressValue(null);
            }
          }}
        />
      )}
    </div>
  );
}
