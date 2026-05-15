// Central reactive state — updated by Firestore listeners
export const S = {
  countries:         [],
  invoices:          [],
  suppliers:         [],
  plans:             [],
  trips:             [],
  vendors:           [],
  editingInvoiceId:  null,
  viewingInvoiceId:  null,
  editingCountryId:  null,
  editingPlanId:     null,
  viewingPlanId:     null,
  editingTripId:     null,
  viewingTripId:     null,
  currentView:       'dashboard',
  dashYear:          new Date().getFullYear(),
};
