import { getAccessToken, createDocument, updateDocument } from './firebase';
import { generateUUID, delay } from './utils';

function deserializeFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value.stringValue !== undefined) result[key] = value.stringValue;
    else if (value.integerValue !== undefined) result[key] = parseInt(value.integerValue, 10);
    else if (value.booleanValue !== undefined) result[key] = value.booleanValue;
    else if (value.nullValue !== undefined) result[key] = null;
    else if (value.arrayValue !== undefined) {
      result[key] = (value.arrayValue.values || []).map(v =>
        v.mapValue ? deserializeFields(v.mapValue.fields || {}) : deserializeFields(v)
      );
    }
    else if (value.mapValue !== undefined) {
      result[key] = deserializeFields(value.mapValue.fields || {});
    }
  }
  return result;
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;
  const collection = 'itineraries';

  // POST /itinerary → create job
  if (request.method === 'POST' && url.pathname === '/itinerary') {
    try {
      const body = await request.json();
      const { destination, durationDays } = body;

      if (typeof destination !== 'string' || typeof durationDays !== 'number' || durationDays <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid input. Expected destination (string) and durationDays (positive integer).' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const jobId = generateUUID();
      const now = new Date().toISOString();

      await createDocument(token, projectId, collection, jobId, {
        status: 'processing',
        destination: destination,
        durationDays: durationDays,
        createdAt: now,
        completedAt: null,
        itinerary: [],
        error: null
      });

      ctx.waitUntil(
        (async () => {
          try {
            await delay(15000); // 15s delay for testing

            const fakeItinerary = Array.from({ length: durationDays }, (_, i) => ({
              day: i + 1,
              theme: `Sample Day ${i + 1}`,
              activities: [
                { time: 'Morning', description: 'Sample activity in the morning.', location: 'Somewhere nice' },
                { time: 'Afternoon', description: 'Sample activity in the afternoon.', location: 'Another place' },
                { time: 'Evening', description: 'Sample dinner recommendation.', location: 'Dinner spot' }
              ]
            }));

            await updateDocument(token, projectId, collection, jobId, {
              status: 'completed',
              destination: destination,
              durationDays: durationDays,
              createdAt: now,
              completedAt: new Date().toISOString(),
              itinerary: fakeItinerary,
              error: null
            });
          } catch (err) {
            await updateDocument(token, projectId, collection, jobId, {
              status: 'failed',
              error: err.message
            });
          }
        })()
      );

      return new Response(JSON.stringify({ jobId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Invalid JSON input.' }), { status: 400 });
    }
  }

  // GET /itinerary/:jobId → retrieve job status/result
  if (request.method === 'GET' && url.pathname.startsWith('/itinerary/')) {
    const jobId = url.pathname.split('/')[2];
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Missing jobId in URL.' }), { status: 400 });
    }

    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${jobId}`;
    const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 404) {
      return new Response(JSON.stringify({ error: 'Job not found.' }), { status: 404 });
    }

    const data = await res.json();
    const cleanData = deserializeFields(data.fields || {});

    return new Response(JSON.stringify(cleanData, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Not found', { status: 404 });
}
