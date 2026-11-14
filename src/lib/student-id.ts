/** توحيد الرقم الجامعي: أرقام عربية/فارسية → لاتينية، حذف المسافات، أحرف كبيرة */
export function normalizeUniversityId(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s‎‏‪-‮]/g, "")
    .toUpperCase();
}
export const UNIVERSITY_ID_RE = /^[0-9A-Z-]{2,32}$/;
export const isValidUniversityId = (id: string) => UNIVERSITY_ID_RE.test(id);
