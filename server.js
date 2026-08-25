require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const GHL_API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = '3Cp5aeX5v3VILD4TtR6R';
const STUDENT_ID_FIELD_ID = 'KhaTFJT6zkHfzzKmSSRS';
const CACHE_REFRESH_MS = 30 * 60 * 1000; // 30 minutes

// In-memory student ID → name cache
const studentCache = new Map();
let cacheReady = false;
let cacheBuilding = false;
let cacheBuiltAt = null;

async function buildStudentCache() {
  if (cacheBuilding) return;
  cacheBuilding = true;
  console.log('Building student ID cache...');

  const newCache = new Map();
  let startAfterId = null;
  let pageCount = 0;

  try {
    while (true) {
      const params = new URLSearchParams({ locationId: LOCATION_ID, limit: '100' });
      if (startAfterId) params.set('startAfterId', startAfterId);

      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/?${params}`,
        { headers: { 'Authorization': `Bearer ${GHL_API_KEY}`, 'Version': '2021-07-28' } }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Cache build page fetch failed:', res.status, JSON.stringify(err));
        break;
      }

      const data = await res.json();
      const contacts = data.contacts ?? [];
      pageCount++;

      for (const c of contacts) {
        const field = (c.customFields ?? []).find(f => f.id === STUDENT_ID_FIELD_ID);
        if (field?.value && typeof field.value === 'string') {
          const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ');
          newCache.set(field.value, fullName || c.email || 'Unknown');
        }
      }

      if (contacts.length < 100) break;
      startAfterId = contacts[contacts.length - 1].id;
    }

    // Atomic swap
    studentCache.clear();
    for (const [k, v] of newCache) studentCache.set(k, v);
    cacheReady = true;
    cacheBuiltAt = new Date().toISOString();
    console.log(`Cache ready: ${studentCache.size} students indexed (${pageCount} pages)`);

  } catch (err) {
    console.error('Cache build error:', err);
  } finally {
    cacheBuilding = false;
  }
}

// Build on startup, refresh every 30 min
buildStudentCache().catch(console.error);
setInterval(() => buildStudentCache().catch(console.error), CACHE_REFRESH_MS);

app.post('/lookup', (req, res) => {
  const { student_id } = req.body || {};

  if (!student_id || typeof student_id !== 'string' || !student_id.startsWith('TF-')) {
    return res.status(400).json({ error: 'Invalid student_id — must start with TF-' });
  }

  if (!cacheReady) {
    return res.status(503)
      .set('Retry-After', '120')
      .json({ error: 'Cache warming up, please retry in ~2 minutes' });
  }

  const name = studentCache.get(student_id);
  if (name) {
    return res.json({ found: true, name, student_id });
  }
  return res.json({ found: false });
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  cacheReady,
  cacheBuilding,
  cacheSize: studentCache.size,
  cacheBuiltAt,
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Enrollment lookup running on port ${PORT}`));
