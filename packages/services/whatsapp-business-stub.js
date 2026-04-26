// Pro MAX feature — auto-send via WhatsApp Business API requires Meta WABA approval + setup.
export async function sendAutomatic() { return { sent: false, reason: 'waba_not_configured' } }
export function isWabaConfigured() { return false }
