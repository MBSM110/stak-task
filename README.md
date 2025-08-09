# Serverless Travel Itinerary Generator

A simple, serverless application that accepts a travel request, generates a structured itinerary using a Large Language Model (LLM), and stores the result in Google Cloud Firestore.

The application responds instantly with a tracking `jobId` and processes itinerary generation asynchronously in the background.

---

## Features

- **Cloudflare Workers** API endpoint for serverless execution.
- **Asynchronous LLM Integration** to avoid blocking responses.
- **Firestore Persistence** for storing and retrieving itineraries.
- **Structured JSON output** matching the required data model.

---

## Architecture Overview

1. **API Request**
   - User sends a POST request to `/` with:
     ```json
     {
       "destination": "Tokyo, Japan",
       "durationDays": 5
     }
     ```
   - The worker stores a `processing` status in Firestore and responds with:
     ```json
     {
       "jobId": "uuid-generated-id"
     }
     ```
   - Response status: `202 Accepted`.

2. **Background Processing**
   - The worker calls an LLM (OpenAI GPT-4o in our case) with a carefully crafted prompt.
   - LLM returns a structured itinerary in JSON.
   - The Firestore document is updated with:
     - Status: `completed` or `failed`
     - Generated itinerary
     - Completion timestamp

3. **Data Model**
   ```json
   {
     "status": "completed",
     "destination": "Paris, France",
     "durationDays": 3,
     "createdAt": "Firestore Timestamp",
     "completedAt": "Firestore Timestamp",
     "itinerary": [
       {
         "day": 1,
         "theme": "Historical Paris",
         "activities": [
           {
             "time": "Morning",
             "description": "Visit the Louvre Museum. Pre-book tickets to avoid queues.",
             "location": "Louvre Museum"
           }
         ]
       }
     ],
     "error": null
   }
   
---

## Installation & Usage

### Clone the Repository
~~~bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
~~~

### Install Dependencies
~~~bash
npm install
~~~

### Set Environment Variables
Create a `.env` file with:
~~~env
OPENAI_API_KEY=your-openai-api-key
FIREBASE_PROJECT_ID=your-firestore-project-id
FIREBASE_CLIENT_EMAIL=your-firebase-service-account-email
FIREBASE_PRIVATE_KEY="your-firebase-private-key"
~~~
You can get these values from your **Firebase Service Account JSON** file in the Google Cloud Console.

### Add Firestore to Your Worker
- In the Firebase Console, create a **Firestore database** (Native mode).  
- Create a collection called `itineraries`.  
- Give your Firebase service account **read/write access**.  
- Add the credentials from your service account to your worker using environment variables.

### Deploy to Cloudflare
~~~bash
npx wrangler login
npx wrangler publish
~~~

### Test the API
~~~bash
curl -X POST "https://<your-worker-subdomain>.workers.dev" \
-H "Content-Type: application/json" \
-d '{"destination":"Tokyo, Japan", "durationDays":5}'
~~~

---

## How to Use the API

### Create a New Itinerary
~~~bash
curl -X POST "https://<your-worker-subdomain>.workers.dev" \
-H "Content-Type: application/json" \
-d '{"destination":"Tokyo, Japan", "durationDays":5}'
~~~
**Example response:**
~~~json
{
  "jobId": "d3fa1440-9ddf-4ed7-aa5c-07d2f95ca770"
}
~~~

### Check Itinerary Status
~~~bash
curl "https://<your-worker-subdomain>.workers.dev/itinerary/<jobId>"
~~~
**Example response:**
~~~json
{
  "status": "completed",
  "destination": "Tokyo, Japan",
  "durationDays": 5,
  "itinerary": [ ... ]
}
~~~
