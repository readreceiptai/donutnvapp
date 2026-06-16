// The exact consent wording, mirrored from DonutNV's own (already legally vetted)
// booking forms. Storing the version string with each consent gives a clean
// TCPA/CAN-SPAM paper trail. Bump the version if you ever change the wording.
export const CONSENT_VERSION = 'donutnv-v1-2026'

export const CONSENT_TEXT = {
  transactional_sms:
    'I agree to receive text messages from DonutNV regarding my account, rewards, and truck alerts I sign up for. Message frequency may vary. Message & data rates may apply. Reply STOP to opt out, HELP for help.',
  marketing_sms:
    'I agree to receive promotional and marketing texts such as special offers, seasonal promotions, and event announcements from DonutNV. Message frequency may vary. Message & data rates may apply. Reply STOP to opt out, HELP for help.',
  marketing_email:
    'I agree to receive emails from DonutNV with offers, new flavors, and where the truck will be. You can unsubscribe anytime.',
}

// Book-a-truck consent — mirrors the two checkboxes on donutnv.com/book-a-truck.
export const BOOKING_CONSENT = {
  customer_care_sms:
    'I agree to receive text messages from DonutNV Franchising Inc. dba DonutNV regarding my event booking confirmations, follow-ups, scheduling coordination, and customer support related to this inquiry. Message frequency may vary. Message & data rates may apply. Reply STOP to opt out, HELP for help.',
  optional_marketing:
    'I agree to receive promotional and marketing messages such as special offers, seasonal promotions, and event announcements from DonutNV Franchising Inc. dba DonutNV. Message frequency may vary. Message & data rates may apply. Reply STOP to opt out, HELP for help.',
}
