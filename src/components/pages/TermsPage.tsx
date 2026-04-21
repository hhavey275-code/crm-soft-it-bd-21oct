export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: March 19, 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
          <p>By accessing and using the Softit BD platform ("Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">2. Description of Service</h2>
          <p>Softit BD provides a digital advertising management platform that enables users to manage ad accounts across multiple platforms (including Meta and TikTok), process wallet top-ups, track advertising spend, and manage business operations related to digital advertising.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">3. User Accounts</h2>
          <p>You must create an account to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to provide accurate and complete information when creating your account.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">4. Financial Transactions</h2>
          <p>The Service facilitates wallet-based transactions for advertising account top-ups. All financial transactions are processed in USD unless otherwise specified. Users are responsible for ensuring sufficient wallet balance before initiating top-ups. Refunds for failed top-ups will be handled on a case-by-case basis.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">5. Third-Party Integrations</h2>
          <p>The Service integrates with third-party advertising platforms including Meta (Facebook) and TikTok. Use of these integrations is subject to the respective platform's terms of service. Softit BD is not responsible for any changes, outages, or issues caused by third-party platforms.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">6. Prohibited Activities</h2>
          <p>Users must not: (a) use the Service for any illegal purpose; (b) attempt to gain unauthorized access to the Service or its systems; (c) interfere with the proper functioning of the Service; (d) use the Service to distribute malware or harmful content; (e) violate any applicable advertising platform policies.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">7. Intellectual Property</h2>
          <p>All content, features, and functionality of the Service are owned by Softit BD and are protected by intellectual property laws. You may not reproduce, distribute, or create derivative works without our express written permission.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">8. Limitation of Liability</h2>
          <p>Softit BD shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service. Our total liability shall not exceed the amount paid by you for the Service in the twelve months preceding the claim.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">9. Account Suspension</h2>
          <p>We reserve the right to suspend or terminate your account at any time if you violate these Terms of Service or engage in activities that may harm the Service or other users.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">10. Changes to Terms</h2>
          <p>We may update these Terms of Service from time to time. We will notify users of significant changes via the platform. Your continued use of the Service after changes constitutes acceptance of the updated terms.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
          <p>For questions about these Terms of Service, please contact us at support@softitbd.com.</p>
        </section>
      </div>
    </div>
  );
}
