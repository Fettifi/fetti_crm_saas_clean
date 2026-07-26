// Single source of truth for the licensing disclosure shown across public pages.
// Owner-occupied (consumer) mortgages require state licensing; investment /
// business-purpose loans are available nationwide.
export const LICENSING_NOTE =
  "Fetti Financial Services LLC · NMLS #2267023. A licensed mortgage lender and broker. State licenses: California DFPI Financing Law License #60DBO-153798 · Florida Mortgage Broker License #MBR7286 · Michigan 1st Mortgage Broker/Lender License #FL0024463. Owner-occupied residential mortgage loans in Florida, Michigan, and California. Investment and business-purpose loans (DSCR, fix & flip, bridge, hard money, and business loans) are available in all 50 states. Equal Housing Opportunity. This is an advertisement, not a commitment to lend; all loans are subject to credit approval and program guidelines.";

// CAN-SPAM (15 U.S.C. §7704) requires EVERY commercial email to carry a valid physical
// postal address AND a clear opt-out. The borrower-facing lanes get this from
// markSignatureLite (lib/notify/emailSignature); the B2B/outreach lanes that call
// sendEmail directly (realtor intros, FSBO seller notes) were missing it — this is their
// shared footer so there is exactly one source of truth. Keep the address in sync with
// COMPANY_MAILING_ADDRESS in app_settings.
export const COMPANY_POSTAL_ADDRESS = "5777 W Century Blvd Suite 1435, Los Angeles, CA 90045";

/** Plain-text CAN-SPAM footer. `optOut` describes how to stop receiving mail. */
export function canSpamFooterText(optOut = 'Reply "unsubscribe" and I won\'t contact you again.'): string {
  return `\n\n—\nFetti Financial Services LLC · NMLS #2267023\n${COMPANY_POSTAL_ADDRESS}\nThis is an advertisement. ${optOut}`;
}

/** HTML CAN-SPAM footer for the same lanes. */
export function canSpamFooterHtml(optOut = 'Reply "unsubscribe" and I won\'t contact you again.'): string {
  return `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.5">` +
    `Fetti Financial Services LLC · NMLS #2267023<br>${COMPANY_POSTAL_ADDRESS}<br>` +
    `This is an advertisement. ${optOut}</div>`;
}

export const LICENSING_SHORT =
  "Mortgage lender & broker · NMLS #2267023 · CA #60DBO-153798 · FL #MBR7286 · MI #FL0024463. Owner-occupied: FL, MI & CA. Investment & business: all 50 states.";

// Mandatory advertising disclosure appended to EVERY social post / caption so
// each one is compliant: licensee name, NMLS ID, Equal Housing, advertisement
// notice, and the standard "not a commitment to lend / subject to credit
// approval" disclaimer. Required on mortgage advertising (NMLS / Reg Z / Reg N).
export const SOCIAL_DISCLOSURE =
  "Fetti Financial Services LLC | NMLS #2267023 · CA #60DBO-153798 · FL #MBR7286 · MI #FL0024463 | Equal Housing Opportunity 🏠\nThis is an advertisement, not a commitment to lend. All loans subject to credit approval & program guidelines; rates/terms may change.";
