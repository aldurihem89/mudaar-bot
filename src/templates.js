// Message templates (category UTILITY, language ar). Created through the Graph API from the admin "Setup" page.
// Templates are needed only when the recipient has not messaged the bot in the last 24 hours.

const BTN3 = [
  { type: 'QUICK_REPLY', text: 'تم' },
  { type: 'QUICK_REPLY', text: 'لاحقاً' },
  { type: 'QUICK_REPLY', text: 'مشكلة' },
];

export const TEMPLATES = [
  {
    name: 'task_assigned',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'تذكير بالمهمة المجدولة رقم {{1}} المتفق عليها لهذا اليوم:\n{{2}}\n{{3}}\nيرجى تحديث حالة تنفيذ هذه المهمة من الأزرار أدناه.',
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
        text: '📋 طلب جديد من {{1}} وصل الساعة {{2}}:\n{{3}}\n{{4}}\nعند الانتهاء اختر من الأزرار بالأسفل.',
        example: { body_text: [['أهل البيت', '2:53 م', 'جهّزي غرفة الضيوف قبل المغرب', 'Prepare the guest room before sunset']] },
      },
      { type: 'BUTTONS', buttons: BTN3 },
    ],
  },
  {
    name: 'task_followup',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'متابعة لحالة المهمة المجدولة التالية، ولم يصلنا تحديث لها بعد:\n{{1}}\n{{2}}\nيرجى تحديث حالة التنفيذ من الأزرار أدناه.',
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
        text: '🛒 قائمة مشتريات اليوم من مساعد البيت ({{1}}):\n{{2}}\nبعد الشراء اختر من الأزرار بالأسفل.',
        example: { body_text: [['3 أصناف', 'حليب، خبز، ماء']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'تم الشراء' },
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
        text: '📊 ملخص يوم {{1}} من مساعد البيت\n\nالمهام المنجزة اليوم:\n• العاملة: {{2}} مهام\n• السائق: {{3}} مهام\n\nالمهام المتأخرة أو المؤجلة: {{4}}\nالمشاكل المبلّغ عنها: {{5}}\nتقييمات اليوم حتى الآن: {{6}}\nما سيُرحَّل إلى الغد: {{7}}\n\nاضغط زراً بالأسفل لعرض التفاصيل أو لتقييم المهام المتبقية.',
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
        text: '✅ {{1}} أنجزت المهمة: {{2}} الساعة {{3}}\nكيف كان الأداء؟ اختر من الأزرار بالأسفل.',
        example: { body_text: [['العاملة', 'تجهيز غرفة الضيوف', '3:40 م']] },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'راضٍ' },
          { type: 'QUICK_REPLY', text: 'مقبول' },
          { type: 'QUICK_REPLY', text: 'غير راضٍ' },
        ],
      },
    ],
  },
  {
    name: 'request_update',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'تحديث على طلبك رقم {{1}}:\n{{2}}\nهذا التحديث يخص طلباً سبق أن سجّلته. للمتابعة يمكنك الرد هنا.',
        example: { body_text: [['1042', 'تمت إعادة جدولة تنفيذ طلب تنظيف المجلس إلى الغد بسبب عطل في مكواة البخار']] },
      },
    ],
  },
];

export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);
