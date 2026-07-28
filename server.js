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

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generatePrescriptionCardSVG(slipData) {
  const font = "font-family='DejaVu Sans, Arial, sans-serif'";
  const shopName = escapeXml(slipData.shopName || 'eyecandyy');
  const tagline = 'Precision Vision &amp; Eyewear Care';
  const custName = escapeXml(slipData.customerName || slipData.customer_name || 'Customer');
  const custPhone = escapeXml(slipData.customerPhone || slipData.customer_phone || '');
  
  const rawDate = slipData.date || '';
  let dateStr = rawDate;
  if (rawDate.includes('-')) {
    const parts = rawDate.split('T')[0].split('-');
    if (parts.length === 3) dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  dateStr = escapeXml(dateStr);

  const rawNext = slipData.nextCheckupDate || slipData.next_checkup_date || '';
  let nextCheckup = rawNext;
  if (rawNext.includes('-')) {
    const parts = rawNext.split('T')[0].split('-');
    if (parts.length === 3) nextCheckup = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  nextCheckup = escapeXml(nextCheckup);

  const totalAmt = escapeXml(String(slipData.totalAmount || slipData.total_amount || '0'));
  const slipId = escapeXml(slipData.slipId || slipData.slip_id || 'SLIP');
  
  const re = slipData.rightEye || {};
  const le = slipData.leftEye || {};
  
  const reSph = escapeXml((re.sph >= 0 ? '+' : '') + (parseFloat(re.sph) || 0).toFixed(2));
  const reCyl = escapeXml((re.cyl >= 0 ? '+' : '') + (parseFloat(re.cyl) || 0).toFixed(2));
  const reAxis = escapeXml((re.axis || 0) + '°');
  const reAdd = escapeXml((re.add >= 0 ? '+' : '') + (parseFloat(re.add) || 0).toFixed(2));

  const leSph = escapeXml((le.sph >= 0 ? '+' : '') + (parseFloat(le.sph) || 0).toFixed(2));
  const leCyl = escapeXml((le.cyl >= 0 ? '+' : '') + (parseFloat(le.cyl) || 0).toFixed(2));
  const leAxis = escapeXml((le.axis || 0) + '°');
  const leAdd = escapeXml((le.add >= 0 ? '+' : '') + (parseFloat(le.add) || 0).toFixed(2));

  // Extract and normalize selected lens types
  const rawTypes = slipData.selectedLensTypes || slipData.selected_lens_types;
  let selectedTypesList = [];
  if (Array.isArray(rawTypes)) {
    selectedTypesList = rawTypes;
  } else if (typeof rawTypes === 'string') {
    try {
      selectedTypesList = JSON.parse(rawTypes);
    } catch (_) {
      selectedTypesList = [rawTypes];
    }
  }

  const normalizedSelected = selectedTypesList.map(t => String(t).toLowerCase().replace(/[^a-z0-9]/g, ''));
  
  function isLensSelected(typeName) {
    const norm = typeName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalizedSelected.includes(norm);
  }

  const quality = slipData.lensQualityCategory || slipData.lens_quality_category || 'Local';
  const brandedOption = slipData.brandedLensOption || slipData.branded_lens_option || '';
  const qualityText = escapeXml(quality === 'Branded' && brandedOption ? `Branded (${brandedOption})` : quality);

  // Helper for rendering a pill with checkmark
  function renderPill(x, y, width, height, label, typeKey, rx = 15) {
    const selected = isLensSelected(typeKey);
    const bg = selected ? '#0D9488' : '#FFFFFF';
    const border = selected ? '#0D9488' : '#CBD5E1';
    const textFill = selected ? '#FFFFFF' : '#475569';
    const checkIcon = selected ? '✔ ' : '○ ';

    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${bg}" stroke="${border}" stroke-width="1.5" rx="${rx}"/>
      <text x="${x + width/2}" y="${y + height/2 + 4}" ${font} font-size="12" font-weight="bold" fill="${textFill}" text-anchor="middle">${checkIcon}${escapeXml(label)}</text>
    `;
  }

  return `
    <svg width="800" height="780" viewBox="0 0 800 780" xmlns="http://www.w3.org/2000/svg">
      <rect width="800" height="780" fill="#FFFFFF" rx="20"/>
      
      <!-- Main Card Container -->
      <rect x="15" y="15" width="770" height="750" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2" rx="16"/>

      <!-- 1. Dark Navy Header Banner -->
      <rect x="25" y="25" width="750" height="90" fill="#152033" rx="14"/>
      
      <!-- Eye Logo Icon -->
      <ellipse cx="65" cy="65" rx="14" ry="8" fill="none" stroke="#0D9488" stroke-width="2.5"/>
      <circle cx="65" cy="65" r="4" fill="#0D9488"/>

      <text x="92" y="60" ${font} font-size="24" font-weight="900" fill="#FFFFFF">${shopName}</text>
      <text x="92" y="80" ${font} font-size="12" fill="#94A3B8">${tagline}</text>
      
      <!-- Header Badges (Date & Slip #) -->
      <rect x="540" y="42" width="220" height="56" fill="none" stroke="#0D9488" stroke-width="1.5" rx="10"/>
      <text x="650" y="62" ${font} font-size="13" font-weight="bold" fill="#0D9488" text-anchor="middle">Slip #${slipId}</text>
      <text x="650" y="84" ${font} font-size="12" fill="#94A3B8" text-anchor="middle">Date: ${dateStr}</text>

      <!-- 2. Lens Type & Quality Section -->
      <rect x="35" y="130" width="730" height="115" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" rx="12"/>
      <text x="55" y="157" ${font} font-size="13" font-weight="bold" fill="#64748B">Lens Type:</text>
      
      <!-- Quality Badge -->
      <rect x="500" y="142" width="245" height="26" fill="#EFF6FF" stroke="#BFDBFE" stroke-width="1" rx="13"/>
      <text x="622" y="159" ${font} font-size="12" font-weight="bold" fill="#1E40AF" text-anchor="middle">Quality: ${qualityText}</text>

      <!-- Pills Row 1 -->
      ${renderPill(55, 172, 100, 30, 'Normal', 'normal')}
      ${renderPill(165, 172, 115, 30, 'Blue Cut', 'blueCut')}
      ${renderPill(290, 172, 125, 30, 'Blue Color', 'blueColor')}
      ${renderPill(425, 172, 135, 30, 'Day & Night', 'dayAndNight')}

      <!-- Pills Row 2 -->
      ${renderPill(55, 208, 130, 26, 'Green Color', 'greenColor', 13)}
      ${renderPill(195, 208, 105, 26, 'Bifocal', 'bifocal', 13)}
      ${renderPill(310, 208, 125, 26, 'Progressive', 'progressive', 13)}

      <!-- 3. Eye Power Table -->
      <text x="35" y="268" ${font} font-size="14" font-weight="bold" fill="#1E293B">Eye Power Table:</text>
      
      <!-- Table Header -->
      <rect x="35" y="278" width="730" height="38" fill="#152033" rx="8"/>
      <text x="220" y="302" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">SPH</text>
      <text x="370" y="302" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">CYL</text>
      <text x="520" y="302" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">AXIS</text>
      <text x="670" y="302" ${font} font-size="13" font-weight="bold" fill="#FFFFFF" text-anchor="middle">ADD</text>

      <!-- RE Row -->
      <rect x="35" y="317" width="730" height="52" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1"/>
      <text x="120" y="340" ${font} font-size="15" font-weight="900" fill="#1E293B" text-anchor="middle">RE</text>
      <text x="120" y="357" ${font} font-size="10" fill="#94A3B8" text-anchor="middle">Right Eye</text>
      <text x="220" y="348" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reSph}</text>
      <text x="370" y="348" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reCyl}</text>
      <text x="520" y="348" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reAxis}</text>
      <text x="670" y="348" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${reAdd}</text>

      <!-- LE Row -->
      <rect x="35" y="370" width="730" height="52" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1" rx="0 0 8 8"/>
      <text x="120" y="393" ${font} font-size="15" font-weight="900" fill="#1E293B" text-anchor="middle">LE</text>
      <text x="120" y="410" ${font} font-size="10" fill="#94A3B8" text-anchor="middle">Left Eye</text>
      <text x="220" y="401" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leSph}</text>
      <text x="370" y="401" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leCyl}</text>
      <text x="520" y="401" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leAxis}</text>
      <text x="670" y="401" ${font} font-size="15" font-weight="bold" fill="#0F172A" text-anchor="middle">${leAdd}</text>

      <!-- 4. Customer Details Box -->
      <rect x="35" y="435" width="730" height="65" fill="#F8FAFC" stroke="#E2E8F0" stroke-width="1" rx="10"/>
      <text x="55" y="460" ${font} font-size="14" font-weight="bold" fill="#1E293B">Customer: ${custName}</text>
      <text x="55" y="484" ${font} font-size="14" font-weight="bold" fill="#64748B">Phone: ${custPhone}</text>

      <!-- 5. Total Amount Box -->
      <rect x="35" y="512" width="730" height="58" fill="#EFF6FF" stroke="#DBEAFE" stroke-width="1.5" rx="12"/>
      <text x="60" y="547" ${font} font-size="15" font-weight="bold" fill="#1E293B">Total Amount:</text>
      <text x="735" y="549" ${font} font-size="24" font-weight="900" fill="#2563EB" text-anchor="end">₹ ${totalAmt}</text>

      <!-- 6. Footer Information -->
      <text x="35" y="594" ${font} font-size="13" font-weight="bold" fill="#0D9488">Next Checkup: ${nextCheckup}</text>
      <text x="765" y="594" ${font} font-size="12" fill="#94A3B8" text-anchor="end">Slip #${slipId}</text>

      <line x1="35" y1="610" x2="765" y2="610" stroke="#E2E8F0" stroke-width="1"/>

      <text x="400" y="630" ${font} font-size="13" font-weight="bold" fill="#0F172A" text-anchor="middle">EYECANDYY OPTICALS</text>
      <text x="400" y="648" ${font} font-size="11" fill="#64748B" text-anchor="middle">123 Vision Avenue, Suite 4A, Optical Market | Ph: +91 98765 43210</text>
      
      <!-- Disclaimer Box -->
      <rect x="35" y="662" width="730" height="75" fill="#FFFBEB" stroke="#FDE68A" stroke-width="1" rx="8"/>
      <text x="400" y="682" ${font} font-size="10" font-weight="bold" fill="#B45309" text-anchor="middle">Disclaimer: This is a Digital Optical Order Slip and NOT a doctor's prescription.</text>
      <text x="400" y="698" ${font} font-size="9.5" fill="#D97706" text-anchor="middle">Any misuse or submission of this document as an official medical prescription is solely the user's responsibility.</text>
      <text x="400" y="714" ${font} font-size="9.5" fill="#D97706" text-anchor="middle">Eyecandyy shall not be held liable for any consequences arising from such misuse.</text>
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

    // Generate high-resolution PNG prescription card natively using sharp from slipData
    if (slipData) {
      try {
        const svgString = generatePrescriptionCardSVG(slipData);
        imageBuffer = await sharp(Buffer.from(svgString)).png().toBuffer();
        console.log('🎨 Generated native crisp PNG prescription card from slipData');
      } catch (svgErr) {
        console.error('SVG Card render error:', svgErr.message);
      }
    }

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
