import { connectHost } from '@spleen/sdk';

const host = connectHost();
host.onAction(async (item) => {
  await host.serviceRequest({ method: 'POST', path: '/note', body: JSON.stringify({ note: JSON.stringify(item) }) });
});
