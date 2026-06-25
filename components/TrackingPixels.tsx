"use client";

// Conversion tracking for Meta (Facebook + Instagram ads), TikTok, and Google.
// Each loads ONLY if its ID is configured (NEXT_PUBLIC_* env), so this safely
// no-ops until you add your Pixel IDs. PageView fires automatically; the "Lead"
// conversion is fired from lib/track.ts on a successful application/quote submit.
import Script from "next/script";
import { useEffect, useState } from "react";
import { getConsent } from "@/lib/consent";

const META = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const TIKTOK = process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID;
const GADS = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID; // e.g. AW-XXXXXXXXX

export default function TrackingPixels() {
  // Advertising/analytics pixels load ONLY after the visitor consents to "all"
  // (CCPA/CPRA + GDPR + GPC). Reacts live the moment consent is granted in the banner.
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const sync = () => setAllowed(getConsent() === "all");
    sync();
    window.addEventListener("fetti-consent", sync);
    return () => window.removeEventListener("fetti-consent", sync);
  }, []);
  if (!allowed) return null;
  return (
    <>
      {META && (
        <Script id="meta-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','${META}');fbq('track','PageView');fbq('track','ViewContent');` }} />
      )}
      {TIKTOK && (
        <Script id="tiktok-pixel" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
          !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
          ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
          ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
          for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
          ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
          ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
          var o=d.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
          ttq.load('${TIKTOK}');ttq.page();ttq.track('ViewContent')}(window,document,'ttq');` }} />
      )}
      {GADS && (
        <>
          <Script id="gtag-src" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GADS}`} />
          <Script id="gtag-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
            window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
            gtag('js',new Date());gtag('config','${GADS}');` }} />
        </>
      )}
    </>
  );
}
