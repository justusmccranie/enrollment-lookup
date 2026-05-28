require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const GHL_API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = '3Cp5aeX5v3VILD4TtR6R';
const STUDENT_ID_FIELD_ID = 'KhaTFJT6zkHfzzKmSSRS';
const STUDENT_ID_FIELD_KEY = 'contact.student_id';

app.post('/lookup', async (req, res) => {
  const { student_id } = req.body || {};

  if (!student_id || typeof student_id !== 'string' || !student_id.startsWith('TF-')) {
    return res.status(400).json({ error: 'Invalid student_id — must start with TF-' });
  }

  try {
    const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationId: LOCATION_ID,
        pageLimit: 1,
        filters: [
          {
            group: 'AND',
            filters: [
              {
                field: STUDENT_ID_FIELD_KEY,
                operator: 'eq',
                value: student_id,
              },
            ],
          },
        ],
      }),
    });

    const data = await ghlRes.json();

    if (!ghlRes.ok) {
      console.error('GHL API error:', data);
      return res.status(502).json({ error: 'GHL API error', detail: data });
    }

    const contacts = data.contacts ?? [];

    if (contacts.length === 0) {
      return res.json({ found: false });
    }

    const contact = contacts[0];
    const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    const studentIdField = (contact.customFields ?? []).find(f => f.id === STUDENT_ID_FIELD_ID);

    return res.json({
      found: true,
      name: fullName || contact.email || 'Unknown',
      student_id: studentIdField?.value ?? student_id,
    });
  } catch (err) {
    console.error('Lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// health check
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Enrollment lookup running on port ${PORT}`));
