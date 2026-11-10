// Message templates (category UTILITY, language ar). Created through the Graph API from the admin "Setup" page.
// Templates are needed only when the recipient has not messaged the bot in the last 24 hours.

const BTN3 = [
  { type: 'QUICK_REPLY', text: 'تم ✅' },
  { type: 'QUICK_REPLY', text: 'لاحقاً ⏳' },
  { type: 'QUICK_REPLY', text: 'مشكلة ⚠️' },
];

export const TEMPLATES = [
  {
    name: 'daily_task',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'مهمة اليوم {{1}}:\n{{2}}\n{{3}}',
        example: { body_text: [['1/3', 'تنظيف المطبخ', 'Clean the kitchen']] },
      },
      { type: 'BUTTONS', buttons: BTN3 },
    ],
  },
  {
    name: 'new_request',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '📋 طلب جديد من {{1}} ({{2}})\n{{3}}\n{{4}}',
        example: { body_text: [['أهل البيت', '2:53 م', 'جهّزي غرفة الضيوف قبل المغرب', 'Prepare the guest room before sunset']] },
      },
      { type: 'BUTTONS', buttons: BTN3 },
    ],
  },
  {
    name: 'task_reminder',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '⏰ تذكير بمهمة لم تكتمل بعد:\n{{1}}\n{{2}}',
        example: { body_text: [['تنظيف المجلس', 'Clean the majlis']] },
      },
      { type: 'BUTTONS', buttons: BTN3 },
    ],
  },
  {
    name: 'shopping_list',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '🛒 مشتريات اليوم ({{1}}):\n{{2}}',
        example: { body_text: [['3 أصناف', 'حليب، خبز، ماء']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'تم ✅' },
          { type: 'QUICK_REPLY', text: 'غير متوفر' },
        ],
      },
    ],
  },
  {
    name: 'daily_summary',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '📊 ملخص {{1}}\nالعاملة: {{2}}\nالسائق: {{3}}\nتأخر: {{4}}\nمشاكل: {{5}}\nتقييم اليوم: {{6}}\nيُرحَّل للغد: {{7}}',
        example: {
          body_text: [['الأحد 8 نوفمبر', '7 من 9', '4 من 5', 'تنظيف المجلس (أُجّل مرتين)', 'مكواة البخار لا تعمل', '😊 6 · 😐 1 · 😞 0', 'مهمتان']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'عرض التفاصيل' },
          { type: 'QUICK_REPLY', text: 'تقييم بقية المهام' },
        ],
      },
    ],
  },
  {
    name: 'rating_request',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '✅ {{1}} أنجزت: {{2}} ({{3}})\nكيف كان الأداء؟',
        example: { body_text: [['العاملة', 'تجهيز غرفة الضيوف', '3:40 م']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: '😊 راضٍ' },
          { type: 'QUICK_REPLY', text: '😐 مقبول' },
          { type: 'QUICK_REPLY', text: '😞 غير راضٍ' },
        ],
      },
    ],
  },
  {
    name: 'house_notice',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: '📣 إشعار من مساعد البيت بخصوص {{1}}:\n{{2}}',
        example: { body_text: [['مهمة تنظيف المجلس', 'العاملة أبلغت عن مشكلة: مكواة البخار لا تعمل']] },
      },
    ],
  },
];

export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);
