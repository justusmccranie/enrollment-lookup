require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const GHL_API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = '3Cp5aeX5v3VILD4TtR6R';
const STUDENT_ID_FIELD_ID = 'KhaTFJT6zkHfzzKmSSRS';

app.post('/lookup', async (req, res) => {
  const { student_id } = req.body || {};

  if (!student_id || typeof student_id !== 'string' || !student_id.startsWith('TF-')) {
    return res.status(400).json({ error: 'Invalid student_id — must start with TF-' });
  }

  try {
    let startAfterId = null;

    while (true) {
      const params = new URLSearchParams({ locationId: LOCATION_ID, limit: '100' });
      if (startAfterId) params.set('startAfterId', startAfterId);

      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Version': '2021-07-28',
          },
        }
      );

      const data = await ghlRes.json();

      if (!ghlRes.ok) {
        console.error('GHL API error:', data);
        return res.status(502).json({ error: 'GHL API error', detail: data });
      }

      const contacts = data.contacts ?? [];

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

      if (contacts.length < 100) break;
      startAfterId = contacts[contacts.length - 1].id;
    }

    return res.json({ found: false });
  } catch (err) {
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// health check
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Enrollment lookup running on port ${PORT}`));
