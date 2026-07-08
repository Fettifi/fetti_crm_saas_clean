// Disposable / burner email domains — the well-known cores plus their common
// aliases. Deliberately curated (not a 40k-entry dump): every entry here is a
// throwaway-mail service with no plausible borrower use. Extend at runtime via
// the SHIELD_DISPOSABLE_EXTRA app_setting (comma-separated), allowlist via
// SHIELD_ALLOW_DOMAINS — no redeploy needed. Matching is by exact domain OR
// any-subdomain suffix (mail.tempmail.com hits tempmail.com).
export const DISPOSABLE_DOMAINS = new Set<string>([
  // mailinator family
  "mailinator.com", "mailinator.net", "mailinator.org", "mailinater.com", "mailinator2.com",
  "sogetthis.com", "spamherelots.com", "thisisnotmyrealemail.com", "tradermail.info",
  // guerrilla mail
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz",
  "guerrillamail.de", "guerrillamailblock.com", "grr.la", "sharklasers.com", "spam4.me",
  // 10 minute mail
  "10minutemail.com", "10minutemail.net", "10minemail.com", "10mail.org", "20minutemail.com",
  "30minutemail.com", "60minutemail.com", "givmail.com",
  // temp-mail family
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmail.dev",
  "tempmailo.com", "tempmail.plus", "tempail.com", "tempr.email", "tmpmail.org",
  "tmpmail.net", "tmpeml.com", "tmp-mail.org", "temporarymail.com", "temporary-mail.net",
  "mytemp.email", "burnermail.io", "burner.email",
  // yopmail
  "yopmail.com", "yopmail.fr", "yopmail.net", "cool.fr.nf", "jetable.fr.nf", "courriel.fr.nf",
  // dispostable / discard
  "dispostable.com", "discard.email", "discardmail.com", "spambog.com", "spambog.de",
  "spambog.ru", "0-mail.com", "0815.ru", "trashmail.com", "trashmail.de", "trashmail.me",
  "trash-mail.com", "kurzepost.de", "objectmail.com", "proxymail.eu", "rcpt.at",
  "wegwerfmail.de", "wegwerfmail.net", "wegwerfmail.org", "wegwerfadresse.de",
  // maildrop / mailnesia / inbox aliases
  "maildrop.cc", "mailnesia.com", "mailcatch.com", "inboxalias.com", "mailin8r.com",
  "mailmetrash.com", "trashymail.com", "mt2015.com", "mt2014.com", "thankyou2010.com",
  "mintemail.com", "mohmal.com", "nada.email", "getnada.com", "abyssmail.com",
  "boximail.com", "clrmail.com", "dropjar.com", "getairmail.com", "inboxbear.com",
  // fakeinbox / spamgourmet
  "fakeinbox.com", "fakebox.org", "spamgourmet.com", "spamgourmet.net", "spamgourmet.org",
  "spamex.com", "spamfree24.org", "spamfree24.de", "spamfree24.com",
  // one-off well-knowns
  "throwawaymail.com", "throwam.com", "mailexpire.com", "mailforspam.com", "mfsa.ru",
  "mailimate.com", "mailscrap.com", "mailzilla.com", "meltmail.com", "mierdamail.com",
  "noclickemail.com", "nogmailspam.info", "nomail.xl.cx", "nospam.ze.tc", "nowmymail.com",
  "objectmail.com", "obobbo.com", "odaymail.com", "one-time.email", "onewaymail.com",
  "otherinbox.com", "ovpn.to", "owlpic.com", "pancakemail.com", "pjjkp.com",
  "recode.me", "recursor.net", "regbypass.com", "safetymail.info", "sendspamhere.com",
  "shieldemail.com", "shitmail.me", "shitmail.org", "sinnlos-mail.de", "slopsbox.com",
  "smellfear.com", "snakemail.com", "sneakemail.com", "snkmail.com", "sofimail.com",
  "solvemail.info", "soodonims.com", "spam.la", "spam.su", "spamavert.com",
  "spambob.com", "spambob.net", "spambob.org", "spambox.us", "spamcannon.com",
  "spamcannon.net", "spamcero.com", "spamcon.org", "spamcorptastic.com", "spamcowboy.com",
  "spamcowboy.net", "spamcowboy.org", "spamday.com", "spameater.com", "spamfighter.cf",
  "spamhole.com", "spamify.com", "spaminator.de", "spamkill.info", "spaml.com",
  "spaml.de", "spammotel.com", "spamobox.com", "spamoff.de", "spamslicer.com",
  "spamspot.com", "spamthis.co.uk", "spamthisplease.com", "spamtrail.com",
  "supergreatmail.com", "supermailer.jp", "suremail.info", "teewars.org",
  "teleworm.com", "teleworm.us", "tempalias.com", "tempe-mail.com", "tempemail.biz",
  "tempemail.com", "tempemail.net", "tempinbox.co.uk", "tempinbox.com", "tempmail2.com",
  "tempmaildemo.com", "tempmailer.com", "tempthe.net", "thanksnospam.info",
  "trbvm.com", "trickmail.net", "tyldd.com", "uggsrock.com", "umail.net",
  "uroid.com", "veryrealemail.com", "vidchart.com", "viditag.com", "viewcastmedia.com",
  "vomoto.com", "vubby.com", "walala.org", "walkmail.net", "wetrainbayarea.com",
  "wh4f.org", "whyspam.me", "willselfdestruct.com", "winemaven.info", "wronghead.com",
  "wuzup.net", "wuzupmail.net", "xagloo.com", "xemaps.com", "xents.com",
  "xmaily.com", "xoxy.net", "yapped.net", "yeah.net.disposable", "yep.it",
  "yogamaven.com", "yopweb.com", "youmailr.com", "ypmail.webarnak.fr.eu.org",
  "yuurok.com", "zehnminutenmail.de", "zetmail.com", "zippymail.info", "zoemail.net",
  "zomg.info", "mailsac.com", "inboxkitten.com", "emailondeck.com", "mail-temp.com",
  "crazymailing.com", "tempmailaddress.com", "email-fake.com", "fakemailgenerator.com",
  "mail.tm", "mail.gw", "dropmail.me", "10mail.com", "emltmp.com", "spymail.one",
  "moakt.com", "moakt.cc", "moakt.ws", "tmails.net", "disbox.net", "disbox.org",
  "vjuum.com", "internxt.com.disposable", "luxusmail.org", "gmailnator.com",
  "smailpro.com", "anonaddy.me", "mailhog.local", "duck.com.disposable",
]);

// Freemail providers that must NEVER be treated as burner OR count toward the
// same-domain-burst signal (half of all real borrowers use these).
export const FREEMAIL_DOMAINS = new Set<string>([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
  "mac.com", "aol.com", "protonmail.com", "proton.me", "pm.me", "zoho.com",
  "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "cox.net",
  "charter.net", "bellsouth.net", "earthlink.net", "juno.com", "optonline.net",
]);

/** True when the domain (or any parent suffix) is a known disposable service. */
export function isDisposableDomain(domain: string, extra: string[] = [], allow: string[] = []): boolean {
  const d = String(domain || "").toLowerCase().trim();
  if (!d) return false;
  if (allow.includes(d)) return false;
  const parts = d.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const suffix = parts.slice(i).join(".");
    if (DISPOSABLE_DOMAINS.has(suffix) || extra.includes(suffix)) return true;
  }
  return false;
}
