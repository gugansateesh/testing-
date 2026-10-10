export function checkIncentiveEligibility(publication: any, cutoffYear?: number, hasApplication?: boolean): { eligible: boolean; reason: string | null } {
  const docType = (publication.document_type_report || '').trim().toLowerCase();
  
  if (docType === 'student publication') {
    return { eligible: false, reason: "Student publications are not eligible for incentives" };
  }
  
  if (publication.is_duplicate) {
    return { eligible: false, reason: "Flagged as a duplicate publication" };
  }
  
  if (cutoffYear && publication.year && Number(publication.year) < cutoffYear) {
    return { eligible: false, reason: "Published before the eligible year" };
  }
  
  if (!docType) {
    return { eligible: false, reason: "Paper type not classified. Contact CFRD." };
  }
  
  const scopusType = (publication.document_type_scopus || '').trim().toLowerCase();
  if (['retracted', 'erratum', 'editorial'].includes(scopusType)) {
    return { eligible: false, reason: `Not eligible: ${publication.document_type_scopus} is not a research publication` };
  }

  if (hasApplication) {
    return { eligible: false, reason: "Application already exists" }; // Typically handled in UI by showing status badge
  }
  
  return { eligible: true, reason: null };
}
