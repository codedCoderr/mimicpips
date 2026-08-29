export const DISCLOSURE_VERSION = "v1.0.0";
export const DISCLOSURE_DATE = "August 2026";

export const LEGAL_DOCS = {
  risk: {
    title: "Risk Disclosure Statement",
    version: `${ DISCLOSURE_VERSION } — ${ DISCLOSURE_DATE }`,
    sections: [
      {
        heading: "1. Financial & Leverage Risk",
        text: "Cryptocurrency futures and perpetual contracts carry extreme market volatility and leverage risks. You can lose a substantial portion or the entirety of your allocated balance in a short period.",
      },
      {
        heading: "2. No Guaranteed Returns",
        text: "All past performance metrics, historical win rates, and backtested results are provided for informational context only. Past performance does not guarantee future results.",
      },
      {
        heading: "3. Execution & Slippage Liability",
        text: "Trade automation is subject to network latency, API outages, exchange queue delays, and market slippage. The platform holds no liability for order failures or pricing variances.",
      },
      {
        heading: "4. Non-Custodial Safeguards",
        text: "Your exchange credentials retain zero withdrawal access. You maintain full ownership and final control of your exchange funds at all times.",
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    version: `${ DISCLOSURE_VERSION } — ${ DISCLOSURE_DATE }`,
    sections: [
      {
        heading: "1. Software License",
        text: "This platform is provided strictly as an automated algorithmic execution tool. It does not provide personalized financial, investment, or legal advice.",
      },
      {
        heading: "2. User Responsibility",
        text: "You are solely responsible for managing your exchange account settings, API key permissions, margin ratios, and risk tolerance thresholds.",
      },
      {
        heading: "3. Limitation of Liability",
        text: "Under no circumstances shall the platform or its operators be held liable for capital losses, system downtime, order rejection, or indirect damages.",
      },
      {
        heading: "4. Termination",
        text: "We reserve the right to suspend API execution services for any user attempting to submit keys with withdrawal permissions or violating system usage limits.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    version: `${ DISCLOSURE_VERSION } — ${ DISCLOSURE_DATE }`,
    sections: [
      {
        heading: "1. Data Collection",
        text: "We collect essential account data (email address, IP address) and API public/secret key pairs required to execute trades on your connected exchange account.",
      },
      {
        heading: "2. Encryption at Rest",
        text: "All API keys are encrypted using AES-256-GCM prior to storage in our database. Plaintext keys are never logged or exposed.",
      },
      {
        heading: "3. Compliance Auditing",
        text: "Timestamped risk acceptance events, IP addresses, and user-agent strings are logged strictly for legal compliance and audit defense.",
      },
      {
        heading: "4. Third-Party Sharing",
        text: "We do not sell, rent, or distribute personal information or trading histories to third-party advertisers or data brokers.",
      },
    ],
  },
};

// Formats document sections into a single string per document for DB auditing
export function getLegalSnapshot () {
  const formatSections = ( doc: typeof LEGAL_DOCS.risk ) =>
    doc.sections.map( ( s ) => `${ s.heading }: ${ s.text }` ).join( "\n\n" );

  return {
    riskDisclosure: formatSections( LEGAL_DOCS.risk ),
    termsOfService: formatSections( LEGAL_DOCS.terms ),
    privacyPolicy: formatSections( LEGAL_DOCS.privacy ),
  };
}