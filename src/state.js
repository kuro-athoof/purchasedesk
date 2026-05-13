// Central reactive state — updated by Firestore listeners
export const S = {
  countries:         [],
  invoices:          [],
  suppliers:         [],
  plans:             [],
  editingInvoiceId:  null,
  viewingInvoiceId:  null,
  editingCountryId:  null,
  editingPlanId:     null,
  viewingPlanId:     null,
  currentView:       'dashboard',
};
