require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const GHL_API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = '3Cp5aeX5v3VILD4TtR6R';
const STUDENT_ID_FIELD_ID = 'KhaTFJT6zkHfzzKmSSRS';
const FETCH_TIMEOUT_MS = 25000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

app.post('/lookup', async (req, res) => {
  const { student_id } = req.body || {};

  if (!student_id || typeof student_id !== 'string' || !student_id.startsWith('TF-')) {
    return res.status(400).json({ error: 'Invalid student_id — must start with TF-' });
  }

  try {
    const ghlRes = await fetchWithTimeout(
      'https://services.leadconnectorhq.com/contacts/search',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GHL_API_KEY}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationId: LOCATION_ID,
          page: 1,
          pageLimit: 10,
          filters: [
            {
              field: `customFields.${STUDENT_ID_FIELD_ID}`,
              operator: 'eq',
              value: student_id,
            },
          ],
        }),
      }
    );

    const data = await ghlRes.json().catch(() => ({}));

    if (!ghlRes.ok) {
      console.error('GHL search error:', ghlRes.status, JSON.stringify(data));
      return res.status(502).json({ error: 'GHL API error', detail: data });
    }

    const contacts = data.contacts ?? [];
    console.log(`Search for ${student_id}: ${contacts.length} result(s), total: ${data.total ?? 'n/a'}`);

    // Guard against GHL ignoring the filter: only accept a contact whose
    // student ID field exactly matches the submitted ID.
    const match = contacts.find(c =>
      (c.customFields ?? []).some(f => f.id === STUDENT_ID_FIELD_ID && f.value === student_id)
    );

    if (match) {
      const fullName = [match.firstName, match.lastName].filter(Boolean).join(' ');
      return res.json({
        found: true,
        name: fullName || match.email || 'Unknown',
        student_id,
      });
    }

    if (contacts.length > 0) {
      console.warn(`Search for ${student_id} returned contacts but none matched exactly`);
    }

    return res.json({ found: false });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('GHL API timeout for student_id:', student_id);
      return res.status(504).json({ error: 'GHL API timeout' });
    }
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Enrollment lookup running on port ${PORT}`));
