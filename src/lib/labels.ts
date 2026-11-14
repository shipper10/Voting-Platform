export const PRIVACY_LABEL: Record<string, string> = {
  strong_anonymous: "سرية قوية",
  restricted_administrative: "سرية إدارية محدودة",
};
export const PRIVACY_NOTICE: Record<string, string> = {
  strong_anonymous: "هذا التصويت سري: لا يخزّن النظام أي رابط بين رقمك الجامعي واختياراتك.",
  restricted_administrative:
    "تنبيه: هذا التصويت ليس مجهول الهوية بالكامل. قد تتمكن لجنة مخولة، بموافقة شخصين وسبب موثق ومسجّل، من الاطلاع على الربط بين هويتك واختيارك.",
};
export const BOX_LABEL: Record<string, string> = {
  draft: "مسودة", scheduled: "لم تبدأ", open: "مفتوحة", paused: "متوقفة مؤقتاً", closed: "مغلقة", cancelled: "ملغاة",
};
export const RESULTS_LABEL: Record<string, string> = {
  none: "—", under_review: "قيد الاعتماد", approved: "معتمدة", published: "منشورة",
};
export const KIND_LABEL: Record<string, string> = {
  top_n: "الأعلى أصواتاً", explicit_roles: "رئيس ونائب مباشرة", single: "اختيار واحد", multi: "اختيار متعدد",
  ranked: "ترتيب تفضيلي", stars: "تقييم بالنجوم", yes_no: "نعم / لا",
};
export const TYPE_LABEL: Record<string, string> = {
  leadership: "ليدر وأمانات", name_proposals: "اسم الدفعة والمقترحات", referendum: "استفتاء",
};
export const VOTE_ERRORS: Record<string, string> = {
  not_allowed: "تعذّر قبول المشاركة بهذه البيانات. تأكد من الرقم الجامعي أو راجع اللجنة.",
  closed: "الصندوق غير مفتوح حالياً.",
  invalid_ballot: "الاختيارات غير مكتملة أو غير صحيحة. راجع الأقسام وأعد المحاولة.",
  rate_limited: "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.",
  server: "تعذّر الإرسال. لم يُسجَّل شيء مؤكد بعد؛ أعد المحاولة.",
};
