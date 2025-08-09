// src/routes.js
import { getAccessToken, createDocument, updateDocument } from './firebase';
import { generateUUID, delay } from './utils';

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/itinerary') {
    try {
      const body = await request.json();
      const { destination, durationDays } = body;

      // Basic validation
      if (typeof destination !== 'string' || typeof durationDays !== 'number' || durationDays <= 0) {
        return new Response(JSON.stringify({ error: 'Invalid input. Expected destination (string) and durationDays (positive integer).' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      const token = await getAccessToken(serviceAccount);
      const projectId = serviceAccount.project_id;
      const collection = 'itineraries';

      const jobId = generateUUID();
      const now = new Date().toISOString();

      // Save initial job
      await createDocument(token, projectId, collection, jobId, {
        status: 'processing',
        destination,
        durationDays,
        createdAt: now,
        completedAt: null,
        itinerary: [],
        error: null
      });

      // Fake background work
      ctx.waitUntil(
        (async () => {
          try {
            await delay(3000); // simulate LLM generation
      
            const fakeItinerary = Array.from({ length: durationDays }, (_, i) => ({
              day: i + 1,
              theme: `Sample Day ${i + 1}`,
              activities: [
                {
                  time: 'Morning',
                  description: 'Sample activity in the morning.',
                  location: 'Somewhere nice'
                },
                {
                  time: 'Afternoon',
                  description: 'Sample activity in the afternoon.',
                  location: 'Another place'
                },
                {
                  time: 'Evening',
                  description: 'Sample dinner recommendation.',
                  location: 'Dinner spot'
                }
              ]
            }));
      
            // --- Completed: include ALL fields explicitly to avoid overwriting ---
            await updateDocument(token, projectId, collection, jobId, {
              status: 'completed',
              destination: destination,       // explicit mapping
              durationDays: durationDays,     // explicit mapping
              createdAt: now,                 // original createdAt
              completedAt: new Date().toISOString(),
              itinerary: fakeItinerary,
              error: null
            });
          } catch (err) {
            // --- Failed: include ALL fields explicitly as well ---
            await updateDocument(token, projectId, collection, jobId, {
              status: 'failed',
              destination: destination,
              durationDays: durationDays,
              createdAt: now,
              completedAt: null,
              itinerary: [],
              error: err.message || 'Unknown error'
            });
          }
        })()
      );

      return new Response(JSON.stringify({ jobId }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });

    } 
    catch (err) {
      return new Response(JSON.stringify({ error: 'Invalid JSON input.', message: err.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response('Not found', { status: 404 });
}
