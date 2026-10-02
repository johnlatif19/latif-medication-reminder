# نظام تذكير الأدوية (لطيف)

نظام ويب كامل لمتابعة أدوية أحد أفراد الأسرة لحظيًا، مع دعم تطبيق موبايل خارجي عبر نفس Firestore data model.

## المكونات

- صفحة تسجيل دخول للمسؤول
- Dashboard عربي RTL لمتابعة حالة الجرعات اليومية
- API Server (Node.js + Express)
- Firebase Admin SDK (Firestore)
- Firebase Web SDK في الـFrontend للـrealtime

## هيكل المشروع
public/
login.html
dashbaord.html
css/
login.css
dashbaord.css
js/
login.js
dashbaord.js
server.js
package.json
vercel.json
.env
.env.example
.gitignore
README.md

text

## المتطلبات

- Node.js 18+
- مشروع Firebase مع Firestore مُفعّل
- حساب Vercel (للنشر)

## الإعداد المحلي

### 1) تثبيت الاعتماديات

```bash
npm install
