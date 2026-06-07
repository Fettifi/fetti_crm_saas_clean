export const metadata = {
  title: "Privacy Policy | Fetti Financial Services",
  description: "Privacy Policy for Fetti Financial Services LLC, including SMS/mobile messaging terms.",
};

const UPDATED = "June 2026";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900 py-12 px-5">
      <div className="max-w-3xl mx-auto prose-sm">
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-gray-500 mt-1">Last updated: {UPDATED}</p>

        <p className="mt-6">
          This Privacy Policy describes how <strong>Fetti Financial Services LLC</strong> ("Fetti,"
          "we," "us") collects, uses, and protects your information when you use our website
          (fettifi.com, app.fettifi.com) and our services.
        </p>

        <h2 className="text-xl font-semibold mt-8">Information we collect</h2>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>Contact details you provide: name, email, and phone number.</li>
          <li>Loan-inquiry details: loan purpose, property value, occupancy, credit range, assets, and notes.</li>
          <li>Technical data: source/UTM and referral information about how you reached us.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8">How we use your information</h2>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>To respond to your inquiry and evaluate financing options.</li>
          <li>To contact you by phone, email, and text message (SMS) about your inquiry, including via automated technology where you have consented.</li>
          <li>To improve our services and for recordkeeping and compliance.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-8">SMS / mobile messaging</h2>
        <p className="mt-2">
          By providing your phone number and submitting an inquiry, you consent to receive SMS text
          messages from Fetti Financial Services related to your inquiry and application. Message
          frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to opt out
          at any time, or <strong>HELP</strong> for help.
        </p>
        <p className="mt-2 font-semibold">
          We do not sell your information. No mobile information (including phone numbers and SMS
          opt-in/consent data) will be shared with or sold to third parties or affiliates for their
          marketing or promotional purposes. SMS opt-in consent is never shared with third parties.
        </p>

        <h2 className="text-xl font-semibold mt-8">How we share information</h2>
        <p className="mt-2">
          We may share your inquiry information with lenders, investors, or service providers solely
          to evaluate and fulfill your financing request, and with vendors who help us operate (e.g.,
          hosting, communications) under confidentiality obligations. We do not share your data with
          third parties for their own marketing.
        </p>

        <h2 className="text-xl font-semibold mt-8">Data retention &amp; security</h2>
        <p className="mt-2">
          We retain information as needed to provide services and meet legal obligations, and use
          reasonable safeguards to protect it. No method of transmission is 100% secure.
        </p>

        <h2 className="text-xl font-semibold mt-8">Your choices</h2>
        <p className="mt-2">
          You may opt out of SMS (reply STOP), unsubscribe from email, or request access to or
          deletion of your information by contacting us below.
        </p>

        <h2 className="text-xl font-semibold mt-8">Contact</h2>
        <p className="mt-2">
          Fetti Financial Services LLC<br />
          5757 W Century Blvd, Suite 700, Los Angeles, CA 90045<br />
          Email: info@fettifi.com · Phone: +1 (920) 754-3647
        </p>

        <p className="mt-8 text-xs text-gray-500">
          Equal Housing Opportunity. This page is provided for general informational and compliance
          purposes and is not legal advice.
        </p>
      </div>
    </main>
  );
}
