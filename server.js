const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const sharp = require('sharp');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { MongoClient } = require('mongodb');
const useMongoDBAuthState = require('./useMongoDBAuthState');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'eyecandyy_secret_key_2026';

let sock = null;
let qrCodeData = null;
let isConnected = false;
let connectedUser = null;

async function connectToWhatsApp() {
  let state, saveCreds;

  if (process.env.MONGODB_URI) {
    try {
      const client = new MongoClient(process.env.MONGODB_URI);
      await client.connect();
      const db = client.db('whatsapp_auth');
      const collection = db.collection('auth_info_baileys');
      const auth = await useMongoDBAuthState(collection);
      state = auth.state;
      saveCreds = auth.saveCreds;
      console.log('✅ Connected to MongoDB for WhatsApp Auth State');
    } catch (err) {
      console.error('❌ Failed to connect to MongoDB, falling back to local file auth:', err);
      const auth = await useMultiFileAuthState('auth_info_baileys');
      state = auth.state;
      saveCreds = auth.saveCreds;
    }
  } else {
    const auth = await useMultiFileAuthState('auth_info_baileys');
    state = auth.state;
    saveCreds = auth.saveCreds;
  }
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: ['Eyecandyy Opticals', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCodeData = qr;
      isConnected = false;
      console.log('⚡ New QR Code generated. Visit /qr in browser to scan.');
    }

    if (connection === 'close') {
      isConnected = false;
      connectedUser = null;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      qrCodeData = null;
      connectedUser = sock.user?.id || 'Connected';
      console.log('✅ WhatsApp successfully connected as:', connectedUser);
    }
  });
}

connectToWhatsApp();

function generatePrescriptionCardSVG(slipData) {
  const font = "font-family='DejaVu Sans, Arial, sans-serif'";
  const shopName = 'eyecandyy';
  const tagline = 'Precision Vision & Eyewear Care';
  const custName = slipData.customerName || slipData.customer_name || 'Customer';
  const custPhone = slipData.customerPhone || slipData.customer_phone || '';
  
  const rawDate = slipData.date || '';
  let dateStr = rawDate;
  if (rawDate.includes('-')) {
    const parts = rawDate.split('T')[0].split('-');
    if (parts.length === 3) dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  const rawNext = slipData.nextCheckupDate || slipData.next_checkup_date || '';
  let nextCheckup = rawNext;
  if (rawNext.includes('-')) {
    const parts = rawNext.split('T')[0].split('-');
    if (parts.length === 3) nextCheckup = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  const totalAmt = slipData.totalAmount || slipData.total_amount || '0';
  const slipId = slipData.slipId || slipData.slip_id || 'SLIP';
  
  const re = slipData.rightEye || {};
  const le = slipData.leftEye || {};
  
  const reSph = (re.sph >= 0 ? '+' : '') + (parseFloat(re.sph) || 0).toFixed(2);
  const reCyl = (re.cyl >= 0 ? '+' : '') + (parseFloat(re.cyl) || 0).toFixed(2);
  const reAxis = (re.axis || 0) + '°';
  const reAdd = (re.add >= 0 ? '+' : '') + (parseFloat(re.add) || 0).toFixed(2);

  const leSph = (le.sph >= 0 ? '+' : '') + (parseFloat(le.sph) || 0).toFixed(2);
  const leCyl = (le.cyl >= 0 ? '+' : '') + (parseFloat(le.cyl) || 0).toFixed(2);
  const leAxis = (le.axis || 0) + '°';
  const leAdd = (le.add >= 0 ? '+' : '') + (parseFloat(le.add) || 0).toFixed(2);

  const selectedTypes = Array.isArray(slipData.selectedLensTypes) 
    ? slipData.selectedLensTypes 
    : (typeof slipData.selectedLensTypes === 'string' ? JSON.parse(slipData.selectedLensTypes || '[]') : []);
  
  const quality = slipData.lensQualityCategory || slipData.lens_quality_category || 'Local';
  const brandedOption = slipData.brandedLensOption || slipData.branded_lens_option || '';
  const qualityText = quality === 'Branded' && brandedOption ? `Branded (${brandedOption})` : quality;

  return `
    <svg width="800" height="720" viewBox="0 0 800 720" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="720" fill="#FFFFFF" rx="20"/>
      
      <!-- Main Card Container -->
      <rect x="15" y="15" width="770" height="690" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2" rx="16"/>

      <!-- 1. Dark Navy Header Banner -->
      <rect x="25" y="25" width="750" height="85" fill="#152033" rx="14"/>
      
      <!-- Eye Logo Icon -->
      <ellipse cx="65" cy="62" rx="14" ry="8" fill="none" stroke="#0D9488" stroke-width="2.5"/>
      <circle cx="65" cy="62" r="4" fill="#0D9488"/>

      <text x="92" y="58" ${font} font-size="24" font-weight="900" fill="#FFFFFF">eyecandyy</text>
      <text x="92" y="78" ${font} font-size="12" fill="#94A3B8">Precision Vision &amp; Eyewear Care</text>
      
      <!-- Date Capsule Badge -->
      <rect x="640" y="50" width="115" height="32" fill="none" stroke="#0D9488" stroke-width="1.5" rx="8"/>
      <text x="697" y="71" ${font} font-size="13" font-weight="bold" fill="#0D9488" text-anchor="middle">${dateStr}</text>

      <!-- 2. Lens Type & Quality Section -->
      <rect x="35" y="125" width="730" height="110" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" rx="12"/>
      <text x="55" y="152" ${font} font-size="13" font-weight="bold" fill="#64748B">Lens Type:</text>
      
      <!-- Quality Badge -->
      <rect x="500" y="137" width="245" height="26" fill="#EFF6FF" stroke="#BFDBFE" stroke-width="1" rx="13"/>
      <text x="622" y="154" ${font} font-size="12" font-weight="bold" fill="#1E40AF" text-anchor="middle">Quality: ${qualityText}</text>

      <!-- Pills Row 1 -->
      <!-- Normal -->
      <rect x="55" y="168" width="90" height="30" fill="${selectedTypes.includes('Normal') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Normal') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="15"/>
      <text x="100" y="187" ${font} font-size="12" font-weight="bold" fill="${selectedTypes.includes('Normal') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Normal</text>

      <!-- Blue Cut -->
      <rect x="155" y="168" width="105" height="30" fill="${selectedTypes.includes('Blue Cut') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Blue Cut') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="15"/>
      <text x="207" y="187" ${font} font-size="12" font-weight="bold" fill="${selectedTypes.includes('Blue Cut') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Blue Cut</text>

      <!-- Blue Color -->
      <rect x="270" y="168" width="115" height="30" fill="${selectedTypes.includes('Blue Color') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Blue Color') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="15"/>
      <text x="327" y="187" ${font} font-size="12" font-weight="bold" fill="${selectedTypes.includes('Blue Color') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Blue Color</text>

      <!-- Day & Night -->
      <rect x="395" y="168" width="125" height="30" fill="${selectedTypes.includes('Day & Night') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Day & Night') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="15"/>
      <text x="457" y="187" ${font} font-size="12" font-weight="bold" fill="${selectedTypes.includes('Day & Night') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Day &amp; Night</text>

      <!-- Pills Row 2 -->
      <!-- Green Color -->
      <rect x="55" y="204" width="120" height="26" fill="${selectedTypes.includes('Green Color') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Green Color') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="13"/>
      <text x="115" y="221" ${font} font-size="11" font-weight="bold" fill="${selectedTypes.includes('Green Color') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Green Color</text>

      <!-- Bifocal -->
      <rect x="185" y="204" width="95" height="26" fill="${selectedTypes.includes('Bifocal') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Bifocal') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="13"/>
      <text x="232" y="221" ${font} font-size="11" font-weight="bold" fill="${selectedTypes.includes('Bifocal') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Bifocal</text>

      <!-- Progressive -->
      <rect x="290" y="204" width="115" height="26" fill="${selectedTypes.includes('Progressive') ? '#0D9488' : '#FFFFFF'}" stroke="${selectedTypes.includes('Progressive') ? '#0D9488' : '#CBD5E1'}" stroke-width="1.5" rx="13"/>
      <text x="347" y="221" ${font} font-size="11" font-weight="bold" fill="${selectedTypes.includes('Progressive') ? '#FFFFFF' : '#475569'}" text-anchor="middle">Progressive</text>

      <!-- 3. Eye Power Table -->
      <text x="35" y="258" ${font} font-size="14" font-weight="bold" fill="#1E293B">Eye Power Table:</text>
      
      <!-- Table Header -->
      <rect x="35" y="268" width="730" height="38" fill="#152033" rx="8"/>
      <text x="220" y="292" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">SPH</text>
      <text x="370" y="292" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">CYL</text>
      <text x="520" y="292" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">AXIS</text>
      <text x="670" y="292" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">ADD</text>

      <!-- RE Row -->
      <rect x="35" y="307" width="730" height="52" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1"/>
      <text x="120" y="330" ${font} font-size="15" font-weight="900" fill="#1E293B" text-anchor="middle">RE</text>
      <text x="120" y="347" ${font} font-size="10" fill="#94A3B8" text-anchor="middle">Right Eye</text>
      <text x="220" y="338" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reSph}</text>
      <text x="370" y="338" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reCyl}</text>
      <text x="520" y="338" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reAxis}</text>
      <text x="670" y="338" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reAdd}</text>

      <!-- LE Row -->
      <rect x="35" y="360" width="730" height="52" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1" rx="0 0 8 8"/>
      <text x="120" y="383" ${font} font-size="15" font-weight="900" fill="#1E293B" text-anchor="middle">LE</text>
      <text x="120" y="400" ${font} font-size="10" fill="#94A3B8" text-anchor="middle">Left Eye</text>
      <text x="220" y="391" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leSph}</text>
      <text x="370" y="391" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leCyl}</text>
      <text x="520" y="391" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leAxis}</text>
      <text x="670" y="391" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leAdd}</text>

      <!-- 4. Customer Details Box -->
      <rect x="35" y="425" width="730" height="70" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" rx="10"/>
      <text x="55" y="452" ${font} font-size="14" font-weight="bold" fill="#1E293B">Customer: ${custName}</text>
      <text x="55" y="478" ${font} font-size="14" font-weight="bold" fill="#64748B">Phone: ${custPhone}</text>

      <!-- 5. Total Amount Box -->
      <rect x="35" y="508" width="730" height="60" fill="#EFF6FF" stroke="#DBEAFE" stroke-width="1.5" rx="12"/>
      <text x="60" y="543" ${font} font-size="15" font-weight="bold" fill="#1E293B">Total Amount:</text>
      <text x="735" y="545" ${font} font-size="24" font-weight="900" fill="#2563EB" text-anchor="end">INR ${totalAmt}</text>

      <!-- 6. Footer Information -->
      <text x="35" y="595" ${font} font-size="13" font-weight="bold" fill="#0D9488">Next Checkup: ${nextCheckup}</text>
      <text x="765" y="595" ${font} font-size="12" fill="#94A3B8" text-anchor="end">Slip #${slipId}</text>

      <line x1="35" y1="615" x2="765" y2="615" stroke="#E2E8F0" stroke-width="1"/>

      <text x="400" y="640" ${font} font-size="14" font-weight="bold" fill="#0F172A" text-anchor="middle">EYECANDYY OPTICALS</text>
      <text x="400" y="660" ${font} font-size="12" fill="#64748B" text-anchor="middle">123 Vision Avenue, Suite 4A, Optical Market</text>
      <text x="400" y="678" ${font} font-size="12" fill="#64748B" text-anchor="middle">Ph: +91 98765 43210 | +91 91234 56789</text>
    </svg>
  `;
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Eyecandyy WhatsApp Gateway</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #f4f6f9;">
        <h1 style="color: #0f172a;">👓 Eyecandyy WhatsApp Gateway API</h1>
        <p style="font-size: 18px;">Status: <strong>${isConnected ? '🟢 CONNECTED' : '🔴 NOT CONNECTED'}</strong></p>
        ${
          !isConnected
            ? '<a href="/qr" style="display: inline-block; padding: 12px 24px; background: #25d366; color: white; border-radius: 8px; text-decoration: none; font-weight: bold;">Scan QR Code to Connect</a>'
            : '<p style="color: #166534;">WhatsApp is active and ready to send automatic prescriptions!</p>'
        }
      </body>
    </html>
  `);
});

app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2 style="color: #166534;">✅ WhatsApp is Already Connected!</h2>
          <p>Logged in as: <strong>${connectedUser}</strong></p>
          <a href="/">Back to Dashboard</a>
        </body>
      </html>
    `);
  }

  if (!qrCodeData) {
    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>⏳ Generating QR Code... Please refresh in 5 seconds.</h2>
          <script>setTimeout(() => location.reload(), 4000);</script>
        </body>
      </html>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(qrCodeData);
    res.send(`
      <html>
        <head>
          <title>Scan WhatsApp QR Code - Eyecandyy</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: sans-serif; text-align: center; padding: 30px; background: #0f172a; color: white;">
          <h2>📱 Scan QR Code to Link WhatsApp</h2>
          <p style="color: #94a3b8;">Open WhatsApp on your phone -> Settings/Menu -> Linked Devices -> Link a Device</p>
          <div style="background: white; padding: 20px; display: inline-block; border-radius: 16px; margin: 20px 0;">
            <img src="${qrImage}" style="width: 280px; height: 280px;" />
          </div>
          <p style="color: #38bdf8;">Auto-refreshing every 15s to keep QR code fresh...</p>
          <script>setTimeout(() => location.reload(), 15000);</script>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error generating QR code image');
  }
});

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    user: connectedUser,
  });
});

app.post('/send-prescription', async (req, res) => {
  const secret = req.headers['x-api-secret'] || req.body.secret;
  if (secret !== API_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized API Secret' });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ status: 'error', message: 'WhatsApp Gateway is not connected yet.' });
  }

  const { phone, message, slipData, imageBase64 } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ status: 'error', message: 'Missing phone or message parameter' });
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
    cleanPhone = '91' + cleanPhone.substring(1);
  }

  let targetJid = `${cleanPhone}@s.whatsapp.net`;
  try {
    const results = await sock.onWhatsApp(cleanPhone);
    if (results && results.length > 0 && results[0].exists) {
      targetJid = results[0].jid;
    }
  } catch (e) {
    console.log('WhatsApp JID lookup warning:', e.message);
  }

  try {
    let imageBuffer = null;

    // Disable SVG Generation due to Font Issues on Linux Servers (Render)
    /*
    if (slipData) {
      try {
        const svgString = generatePrescriptionCardSVG(slipData);
        imageBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
      } catch (svgErr) {
        console.error('SVG Card render error:', svgErr.message);
      }
    }
    */

    if (!imageBuffer && imageBase64) {
      try {
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } catch (b64Err) {
        console.error('Base64 parse error:', b64Err.message);
      }
    }

    if (imageBuffer) {
      await sock.sendMessage(targetJid, {
        image: imageBuffer,
        caption: message,
      });
      console.log(`✅ Prescription PNG Card sent to ${cleanPhone}`);
      return res.json({ status: 'success', message: 'Prescription image card sent successfully via WhatsApp!' });
    }

    await sock.sendMessage(targetJid, { text: message });
    console.log(`✅ Prescription text sent to ${cleanPhone}`);
    res.json({ status: 'success', message: 'Prescription text sent successfully via WhatsApp!' });
  } catch (error) {
    console.error('Error sending message via Baileys:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Eyecandyy WhatsApp Gateway running on port ${PORT}`);
});
