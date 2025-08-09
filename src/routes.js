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

      // Save initial document
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
            // --- Call OpenAI ---
            const prompt = `
Generate a detailed ${durationDays}-day travel itinerary for ${destination}.
Return ONLY JSON in this format:
[
  {
    "day": 1,
    "theme": "Theme of the day",
    "activities": [
      { "time": "Morning", "description": "Activity details", "location": "Location name" },
      { "time": "Afternoon", "description": "Activity details", "location": "Location name" },
      { "time": "Evening", "description": "Activity details", "location": "Location name" }
    ]
  }
]
Example for 2 days:
[
  {
    "day": 1,
    "theme": "Historical Paris",
    "activities": [
      { "time": "Morning", "description": "Visit the Louvre Museum. Pre-book tickets.", "location": "Louvre Museum" },
      { "time": "Afternoon", "description": "Walk along the Seine and visit Notre-Dame.", "location": "Île de la Cité" },
      { "time": "Evening", "description": "Dinner in the Latin Quarter.", "location": "Latin Quarter" }
    ]
  },
  {
    "day": 2,
    "theme": "Art and Culture",
    "activities": [
      { "time": "Morning", "description": "Visit Musée d'Orsay.", "location": "Musée d'Orsay" },
      { "time": "Afternoon", "description": "Explore Montmartre and Sacré-Cœur.", "location": "Montmartre" },
      { "time": "Evening", "description": "See a cabaret show.", "location": "Moulin Rouge" }
    ]
  }
]
            `;

            const llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.OPENAI_API_KEY}`
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7
              })
            });

            if (!llmRes.ok) {
              throw new Error(`OpenAI API error: ${await llmRes.text()}`);
            }

            const llmData = await llmRes.json();
            let itinerary;

            try {
              itinerary = JSON.parse(llmData.choices[0].message.content);
            } catch {
              throw new Error("Invalid JSON from LLM");
            }

            // Save LLM result
            await updateDocument(token, projectId, collection, jobId, {
              status: 'completed',
              destination: destination,
              durationDays: durationDays,
              createdAt: now,
              completedAt: new Date().toISOString(),
              itinerary,
              error: null
            });

          } catch (err) {
            // If LLM fails, set status to failed
            await updateDocument(token, projectId, collection, jobId, {
              status: 'failed',
              destination: destination,
              durationDays: durationDays,
              createdAt: now,
              completedAt: new Date().toISOString(),
              itinerary: [],
              error: err.message
            });

            /*
            // --- Optional: fake itinerary fallback ---
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
            */
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

  // GET /itinerary/:jobId
  if (request.method === 'GET' && url.pathname.startsWith('/itinerary/')) {
    const jobId = url.pathname.split('/')[2];
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    const data = await res.json();
    const doc = deserializeFields(data.fields || {});
    return new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Not found', { status: 404 });
}
