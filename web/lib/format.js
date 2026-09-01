/** Dates a customer reads, not timestamps a developer reads. */
export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The serial as it is printed on the box: grouped, spaced, easy to read back. */
export function formatSerial(serial) {
  return String(serial || '').toUpperCase();
}

const EVENT_LABELS = {
  created: 'Manufactured',
  dispatched: 'Dispatched',
  received: 'Received',
  dispensed: 'Dispensed to a patient',
  verified: 'Verified by a customer',
  flagged: 'Flagged for review',
};

export function eventLabel(type) {
  return EVENT_LABELS[type] || type;
}
