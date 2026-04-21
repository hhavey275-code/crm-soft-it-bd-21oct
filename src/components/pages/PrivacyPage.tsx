export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: March 19, 2026</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
          <p>Softit BD ("we", "our", "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our digital advertising management platform ("Service").</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">2. Information We Collect</h2>
          <p><strong>Personal Information:</strong> Name, email address, phone number, company name, business address.</p>
          <p><strong>Financial Information:</strong> Wallet balances, transaction history, payment references, bank account details for top-up processing.</p>
          <p><strong>Advertising Data:</strong> Ad account IDs, spend data, campaign metrics, and account status information obtained from connected advertising platforms (Meta, TikTok).</p>
          <p><strong>Usage Data:</strong> Log data, device information, browser type, and interaction patterns within the Service.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">3. How We Use Your Information</h2>
          <p>We use collected information to: (a) provide and maintain the Service; (b) process financial transactions and wallet top-ups; (c) sync and display advertising account data; (d) communicate with you about your account; (e) improve the Service; (f) comply with legal obligations.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">4. Third-Party Data Sharing</h2>
          <p>We interact with third-party advertising platforms (Meta and TikTok) to fetch account data and process fund transfers. We only share the minimum necessary information required for these operations. We do not sell your personal data to third parties.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">5. Data Security</h2>
          <p>We implement industry-standard security measures including encryption of sensitive data (such as API access tokens), secure authentication, and role-based access controls. However, no method of transmission over the Internet is 100% secure.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">6. Data Retention</h2>
          <p>We retain your personal information for as long as your account is active or as needed to provide the Service. Transaction records are retained for accounting and compliance purposes. You may request deletion of your account and associated data by contacting us.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">7. Your Rights</h2>
          <p>You have the right to: (a) access your personal data; (b) correct inaccurate data; (c) request deletion of your data; (d) object to processing of your data; (e) request a copy of your data in a portable format.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">8. Cookies and Tracking</h2>
          <p>We use essential cookies and local storage for authentication and session management. We do not use third-party tracking or advertising cookies.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">9. Children's Privacy</h2>
          <p>The Service is not intended for users under the age of 18. We do not knowingly collect personal information from children.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">10. Changes to This Policy</h2>
          <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-2">11. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact us at support@softitbd.com.</p>
        </section>
      </div>
    </div>
  );
}
