/**
 * ZOFF Champions: every number and label from the programme deck lives here.
 * Change the programme by editing this file, not the logic files.
 */

var CONFIG = {
  TIMEZONE: 'Asia/Kolkata',

  // Slide 14: "100 approved points gets you into the prize ranking."
  QUALIFY_POINTS: 100,

  // Slide 20 fallback. 'ALL' = every approved point counts toward paid prizes (the deck as written).
  // 'ORIGINALS_ONLY' = engagement points are tracked for recognition only, and paid prizes are
  // ranked on the actions listed in PRIZE_ACTIONS_WHEN_ORIGINALS_ONLY.
  PRIZE_BASIS: 'ALL',
  PRIZE_ACTIONS_WHEN_ORIGINALS_ONLY: ['ORIGINAL_POST', 'ORIGINAL_REEL', 'FACTORY_VIDEO', 'FACTORY_REEL'],

  // Slide 18.
  MONTHLY_CAP: 20000,
  RECOGNITION_ALLOWANCE: 4000,

  // Slide 5: "Use time off within 60 days".
  TIME_OFF_USE_WITHIN_DAYS: 60,
  TIME_OFF_REMINDER_DAYS_BEFORE: 7,

  // Slide 16: "Final scores by working day 2. Queries by day 4. Winners by day 5."
  FINAL_SCORES_WORKING_DAY: 2,
  QUERIES_CLOSE_WORKING_DAY: 4,
  WINNERS_WORKING_DAY: 5,
  // 0 = Sunday, 6 = Saturday. Override in the Settings sheet (WEEKEND_DAYS) if Saturday is a working day.
  DEFAULT_WEEKEND_DAYS: [0, 6],

  // Friday leaderboard run (hour of day in TIMEZONE).
  FRIDAY_HOUR: 17,
  DAILY_HOUR: 9
};

/**
 * Point rules (slides 9, 10, 12). `scope` decides what "counts once" means:
 *   post         - once per employee per daily post
 *   conversation - once per employee per WhatsApp conversation
 *   original     - once per piece of original content, across everyone
 *   quora        - once per Quora answer, across everyone
 * Labels are also the form checkbox/choice text, so keep them identical.
 */
var ACTIONS = {
  LIKE:          { points: 1,  scope: 'post',         label: 'Liked the post' },
  COMMENT:       { points: 4,  scope: 'post',         label: 'Left a relevant comment in my own words' },
  SOCIAL_SHARE:  { points: 5,  scope: 'post',         label: 'Shared on my story or profile, with my own line and the page tagged' },
  WA_STATUS:     { points: 5,  scope: 'post',         label: 'Put it on WhatsApp Status with the link for 24 hours' },
  FRIENDS_GROUP: { points: 5,  scope: 'post',         label: 'Shared with interested friends or one welcoming WhatsApp group' },
  HELPFUL_REPLY: { points: 5,  scope: 'conversation', label: 'Helpful reply to a real WhatsApp question' },
  ORIGINAL_POST: { points: 25, scope: 'original',     label: 'An original post, poster, photo story or carousel' },
  ORIGINAL_REEL: { points: 50, scope: 'original',     label: 'An original Reel' },
  FACTORY_VIDEO: { points: 50, scope: 'original',     label: 'A clear factory video that Marketing can use' },
  // Slide 10: "A factory Reel earns 50 total", so it is its own type, not Reel + factory video.
  FACTORY_REEL:  { points: 50, scope: 'original',     label: 'A factory Reel (earns 50 in total)' },
  QUORA_ANSWER:  { points: 20, scope: 'quora',        label: 'A useful Quora answer that says I work at ZOFF' }
};

// Engagement actions ticked on the form, in the order the deck lists them.
var ENGAGEMENT_ACTIONS = ['LIKE', 'COMMENT', 'SOCIAL_SHARE', 'WA_STATUS', 'FRIENDS_GROUP'];
var ORIGINAL_ACTIONS = ['ORIGINAL_POST', 'ORIGINAL_REEL', 'FACTORY_VIDEO', 'FACTORY_REEL'];

// Slide 14. Unawarded prizes stay unspent (slide 18).
var PRIZES = [
  { rank: 1, name: 'Golden Ticket',       kind: 'reward',   value: 8000, detail: 'Reward choice up to ₹8,000' },
  { rank: 2, name: 'Runner-up Reward',    kind: 'reward',   value: 3000, detail: 'Choice up to ₹3,000' },
  { rank: 3, name: 'Mini Escape',         kind: 'reward',   value: 2500, detail: 'An experience up to ₹2,500' },
  { rank: 4, name: 'ZOFF Merch Drop',     kind: 'reward',   value: 1000, detail: 'ZOFF merch bundle worth up to ₹1,000' },
  { rank: 5, name: 'Food Drop',           kind: 'reward',   value: 750,  detail: 'Food voucher worth ₹750' },
  { rank: 6, name: 'Food Drop',           kind: 'reward',   value: 750,  detail: 'Food voucher worth ₹750' },
  { rank: 7, name: 'A Whole Day Off',     kind: 'time_off', value: 0,    detail: 'One paid day off' },
  { rank: 8, name: 'Two-Hour Freedom Pass', kind: 'time_off', value: 0,  detail: 'Two-hour early leave or late start' },
  { rank: 9, name: 'Two-Hour Freedom Pass', kind: 'time_off', value: 0,  detail: 'Two-hour early leave or late start' }
];

var BRANDS = ['ZOFF', 'Akash'];

var STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

var ENTRY_TYPES = {
  ENGAGEMENT: 'Engagement on a daily ZOFF or Akash post',
  ORIGINAL: 'My original content',
  QUORA: 'A Quora answer'
};

// Form question titles. Intake reads answers by these exact titles.
var Q = {
  EMPLOYEE_ID: 'Employee ID',
  ENTRY_TYPE: 'What is this entry for?',
  BRAND: 'ZOFF or Akash?',
  POST_URL: 'Post link (the daily link Marketing shared)',
  ACTIONS: 'What did you do on this post?',
  HELPFUL_REPLIES: 'Helpful WhatsApp replies: how many separate conversations?',
  PROOF_LINKS: 'Proof links (optional)',
  PROOF_FILES: 'Proof screenshots',            // File upload: add by hand, FormApp cannot create it
  ORIGINAL_BRAND: 'Is this original for ZOFF or Akash?',
  ORIGINAL_TYPE: 'What did you create?',
  ORIGINAL_URL: 'Where is it published? (link, if posted)',
  ORIGINAL_DESC: 'Describe it in one line',
  ORIGINAL_FILES: 'Clean original file',       // File upload: add by hand
  ORIGINAL_CONFIRM: 'Confirm',
  QUORA_BRAND: 'Is the answer about ZOFF or Akash?',
  QUORA_URL: 'Quora answer link',
  QUORA_CONFIRM: 'Disclosure'
};

var SHEETS = {
  SETTINGS: { name: 'Settings', headers: ['Key', 'Value', 'Notes'] },
  EMPLOYEES: { name: 'Employees', headers: ['Employee ID', 'Name', 'Email', 'Manager email', 'Registered on', 'Eligible', 'PIN'] },
  POSTS: { name: 'Posts', headers: ['Date shared', 'Brand', 'Post link', 'Post key', 'Notes'] },
  REVIEW: { name: 'Review', headers: [
    'Item ID', 'Response ID', 'Submitted (IST)', 'Month', 'Activity date', 'Employee ID', 'Name', 'Email',
    'Entry type', 'Brand', 'Action', 'Post key', 'Unique key', 'File hash', 'Content key', 'Evidence', 'Claimed points',
    'Flags', 'Decision', 'Reviewer note', 'Reviewed by', 'Reviewed at', 'Counted points'
  ] },
  LEADERBOARD: { name: 'Leaderboard', headers: [
    'Position', 'Name', 'Employee ID', 'Points', 'Prize points', 'Active days', 'Posts supported',
    'Qualified', 'Points to qualify', 'Prize', 'Note'
  ] },
  WINNERS: { name: 'Winners', headers: [
    'Month', 'Rank', 'Employee ID', 'Name', 'Email', 'Prize', 'Detail', 'Value (₹)', 'Kind',
    'Use time off by', 'Time off used', 'Reminder drafted', 'Certificate', 'Fulfilment status'
  ] },
  DRAW_LOG: { name: 'Draw log', headers: ['Month', 'Run at', 'Seed', 'Tied group (points / days / posts)', 'Resulting order'] },
  AUDIT: { name: 'Audit log', headers: ['When', 'Who', 'What'] }
};

var SETTING_KEYS = {
  FORM_ID: 'FORM_ID',
  MARKETING_EMAILS: 'MARKETING_EMAILS',
  HOLIDAYS: 'HOLIDAYS',
  WEEKEND_DAYS: 'WEEKEND_DAYS',
  CERT_TEMPLATE_ID: 'CERT_TEMPLATE_ID',
  CERT_FOLDER_ID: 'CERT_FOLDER_ID',
  PUBLIC_SHEET_ID: 'PUBLIC_SHEET_ID',
  PROOF_FOLDER_ID: 'PROOF_FOLDER_ID',
  FINAL_SCORES_DONE: 'FINAL_SCORES_DONE_FOR',
  FINALISED: 'FINALISED_THROUGH'
};
