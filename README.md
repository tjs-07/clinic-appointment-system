# Dr. Aarav Homeopathy Clinic

Next.js (App Router, TypeScript) clinic website with online/offline appointment booking, Razorpay consultation fee payment, Google Calendar + Meet scheduling, and an admin portal. Data is stored in **MongoDB Atlas**.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill it in (a ready-to-use `.env.local` is included in this zip).
3. In MongoDB Atlas, open **Network Access** and allow the IP you run the app from
   (use `0.0.0.0/0` for hosted deployments such as Vercel).
4. Run `npm run dev` and open http://localhost:3000

## Admin portal

Open `/admin`. A single admin account is created in the `admins` collection the first time the app
touches the database:

| Admin ID | Password |
|----------|----------|
| `admin@123` | `pass@123` |

Passwords are stored hashed (scrypt). The admin's email is `tejasmhaske047@gmail.com`.

## MongoDB collections

`appointments`, `patients`, `payments`, `doctor_availability`, `google_oauth_tokens`, `admins`.
Indexes and the admin account are created automatically on first use.

## Google Calendar / Meet

1. Create OAuth credentials in Google Cloud Console (Web application) with redirect URI
   `http://localhost:3000/api/auth/google/callback`, and enable the Google Calendar API.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`.
3. Open `/appointment`, click **Connect Google Calendar**, and sign in as `tejasmhaske047@gmail.com`.
   Tokens are saved in MongoDB.

## Scripts

```bash
npm run dev     # development
npm run build   # production build
npm run start   # run the production build
```
