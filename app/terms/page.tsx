export const metadata = {
  title: "Terms & Conditions | Fetti Financial Services",
  description: "Terms and Conditions for Fetti Financial Services LLC, including SMS messaging terms.",
};

const UPDATED = "June 2026";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900 py-12 px-5">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold">Terms &amp; Conditions</h1>
        <p className="text-gray-500 mt-1">Last updated: {UPDATED}</p>

        <p className="mt-6">
          These Terms govern your use of the websites and services of{" "}
          <strong>Fetti Financial Services LLC</strong> ("Fetti," "we," "us"). By using our site or
          submitting an inquiry, you agree to these Terms.
        </p>

        <h2 className="text-xl font-semibold mt-8">Our services</h2>
        <p className="mt-2">
          Fetti provides mortgage and real-estate financing brokerage services (including DSCR,
          fix-and-flip, bridge, and hard-money loans). Submitting an inquiry does not create a loan
          commitment. All loans are subject to credit approval, program guidelines, and applicable
          law. We are not a lender unless expressly stated; rates and terms are not guaranteed.
        </p>

        <h2 className="text-xl font-semibold mt-8">Your responsibilities</h2>
        <p className="mt-2">
          You agree to provide accurate information and to use our services lawfully. You are
          responsible for the information you submit.
        </p>

        <h2 className="text-xl font-semibold mt-8">SMS messaging terms</h2>
        <p className="mt-2">
          By providing your mobile number and submitting an inquiry, you consent to receive recurring
          SMS messages from Fetti Financial Services about your inquiry and application, including via
          automated technology. Consent is not a condition of any purchase or service. Message
          frequency varies; message and data rates may apply. Reply <strong>STOP</strong> to cancel or{" "}
          <strong>HELP</strong> for help. Carriers are not liable for delayed or undelivered messages.
        </p>

        <h2 className="text-xl font-semibold mt-8">Disclaimers &amp; limitation of liability</h2>
        <p className="mt-2">
          Our site and services are provided "as is." To the extent permitted by law, Fetti is not
          liable for indirect or consequential damages arising from your use of our services.
        </p>

        <h2 className="text-xl font-semibold mt-8">Governing law</h2>
        <p className="mt-2">These Terms are governed by the laws of the State of California.</p>

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
