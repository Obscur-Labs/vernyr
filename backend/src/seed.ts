/**
 * StudyCRM — Database Seed Script
 * Run:  npx ts-node src/seed.ts
 *
 * Creates:
 *  • 6 staff users  (admin × 3, counsellor × 3) + 3 university partners
 *  • 3 student users + linked Student records
 *  • 12 Leads  (across all statuses, assigned to counsellors)
 *  • Applications, Visas, Payments, Documents per student
 *  • Notifications for each student
 *  • 1 Conversation + messages (student ↔ counsellor)
 *
 * Safe to re-run — drops collections first then re-seeds.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

// ── Models ───────────────────────────────────────────────────────────────────
import User, { usesEmailLogin, type UserRole } from './models/User';
import Student      from './models/Student';
import Lead         from './models/Lead';
import Application  from './models/Application';
import Visa         from './models/Visa';
import Payment      from './models/Payment';
import DocumentModel from './models/Document';
import Notification from './models/Notification';
import Conversation from './models/Conversation';
import Message      from './models/Message';
import PortalAccount from './models/PortalAccount';

// ── Helpers ───────────────────────────────────────────────────────────────────
const id = () => new mongoose.Types.ObjectId();
const daysAgo  = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

async function hash(plain: string) {
  return bcrypt.hash(plain, 12);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/studycrm';
  console.log(`\n🔌  Connecting to ${uri} …`);
  await mongoose.connect(uri);
  console.log('✅  Connected\n');

  // ── 1. Drop existing data ─────────────────────────────────────────────────
  await Promise.all([
    User.deleteMany({}),
    Student.deleteMany({}),
    Lead.deleteMany({}),
    Application.deleteMany({}),
    Visa.deleteMany({}),
    Payment.deleteMany({}),
    DocumentModel.deleteMany({}),
    Notification.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
  ]);
  console.log('🗑️   Cleared existing data');

  // ── 2. Staff users ────────────────────────────────────────────────────────
  const pwDefault = await hash('password123');

  const staffData = [
    { name: 'Alex Rivera',     username: 'alex.rivera',    email: 'alex@studycrm.com',   role: 'admin',      universityName: undefined },
    { name: 'Jordan Blake',    username: 'admin',          email: 'admin@studycrm.com',  role: 'admin',      universityName: undefined },
    { name: 'Morgan Chen',     username: 'morgan.chen',    email: 'morgan@studycrm.com', role: 'admin',      universityName: undefined },
    { name: 'Sarah Thompson',  username: 'sarah.thompson', email: undefined,             role: 'counsellor', universityName: undefined },
    { name: 'David Okafor',    username: 'david.okafor',   email: undefined,             role: 'counsellor', universityName: undefined },
    { name: 'Priya Sharma',    username: 'priya.sharma',   email: undefined,             role: 'counsellor', universityName: undefined },
    // External university partners — scoped to their institution
    { name: 'James Whitfield', username: 'manchester.admissions', email: undefined, role: 'university', universityName: 'University of Manchester' },
    { name: 'Mei Lin',         username: 'melbourne.intl',        email: undefined, role: 'university', universityName: 'University of Melbourne' },
    { name: 'Robert Hughes',   username: 'edinburgh.apply',       email: undefined, role: 'university', universityName: 'University of Edinburgh' },
  ];

  const staff = await User.insertMany(
    staffData.map(u => ({
      name: u.name, username: u.username, role: u.role,
      password: pwDefault, isActive: true,
      ...(u.email ? { email: u.email } : {}),
      ...(u.universityName ? { universityName: u.universityName } : {}),
    }))
  );

  // Looked up by username rather than array position, so reordering or adding
  // a row can never silently reassign someone's records.
  const byUsername = new Map(staff.map(u => [u.username as string, u]));
  const pick = (username: string) => {
    const u = byUsername.get(username);
    if (!u) throw new Error(`seed: no staff user '${username}'`);
    return u;
  };

  const admin       = pick('admin');
  const counsellor1 = pick('sarah.thompson');
  const counsellor2 = pick('david.okafor');
  const counsellor3 = pick('priya.sharma');

  const uniPartners = staff.filter(u => u.role === 'university');
  console.log(`👥  Created ${staff.length - uniPartners.length} staff users + ${uniPartners.length} university partners`);

  // ── 3. Students + linked user accounts ───────────────────────────────────
  type StudentInput = {
    personal: { name: string; email: string; phone: string; dob?: string; gender?: string; nationality?: string; address?: string };
    stage: 'inquiry'|'counselling'|'university_selection'|'application_submitted'|'offer_letter'|'fee_payment'|'cas_i20'|'visa_filing'|'visa_approved'|'departure';
    assignedCounsellor: mongoose.Types.ObjectId;
    education: object;
    scores: object;
    passport: object;
    preferences: object;
    notes?: string;
  };

  const studentInputs: StudentInput[] = [
    {
      personal: {
        name: 'Aisha Malik',
        email: 'aisha@student.com',
        phone: '+92-300-1234567',
        dob: '2001-03-15',
        gender: 'Female',
        nationality: 'Pakistani',
        address: '45 Garden Town, Lahore, Pakistan',
      },
      stage: 'visa_filing',
      assignedCounsellor: counsellor1._id as mongoose.Types.ObjectId,
      education: {
        highestLevel: 'undergraduate',
        board12: 'BISE Lahore',
        percentage12: 88,
        graduationCollege: 'University of Punjab',
        graduationScore: 3.6,
      },
      scores: { ielts: 7.0, gre: 315 },
      passport: { number: 'AB1234567', expiry: '2029-06-20', issued: '2019-06-20' },
      preferences: {
        countries: ['UK', 'Canada'],
        universities: ['University of Manchester', 'University of Toronto'],
        courses: ['Computer Science', 'Data Science'],
        intake: 'September 2025',
      },
      notes: 'Strong academic profile. Scholarship applicant.',
    },
    {
      personal: {
        name: 'Rahul Verma',
        email: 'rahul@student.com',
        phone: '+91-98765-43210',
        dob: '2000-07-22',
        gender: 'Male',
        nationality: 'Indian',
        address: 'B-12, Sector 62, Noida, India',
      },
      stage: 'offer_letter',
      assignedCounsellor: counsellor2._id as mongoose.Types.ObjectId,
      education: {
        highestLevel: 'undergraduate',
        graduationCollege: 'Delhi Technological University',
        graduationScore: 3.4,
      },
      scores: { ielts: 6.5, gmat: 680 },
      passport: { number: 'P9876543', expiry: '2028-11-10', issued: '2018-11-10' },
      preferences: {
        countries: ['USA', 'Australia'],
        universities: ['University of Melbourne', 'University of Sydney'],
        courses: ['MBA', 'Business Analytics'],
        intake: 'February 2025',
      },
      notes: 'Interested in business schools with strong alumni networks.',
    },
    {
      personal: {
        name: 'Emily Zhang',
        email: 'emily@student.com',
        phone: '+86-13800138000',
        dob: '2002-11-05',
        gender: 'Female',
        nationality: 'Chinese',
        address: '88 Nanjing Road, Shanghai, China',
      },
      stage: 'counselling',
      assignedCounsellor: counsellor3._id as mongoose.Types.ObjectId,
      education: {
        highestLevel: '12th',
        board12: 'Shanghai Education Bureau',
        percentage12: 92,
      },
      scores: { ielts: 7.5 },
      passport: { number: 'G55443322', expiry: '2030-04-15', issued: '2020-04-15' },
      preferences: {
        countries: ['UK', 'Germany', 'Netherlands'],
        universities: ['Imperial College London', 'TU Munich'],
        courses: ['Electrical Engineering', 'Computer Engineering'],
        intake: 'September 2025',
      },
    },
  ];

  const studentDocs = await Student.insertMany(studentInputs);
  console.log(`🎓  Created ${studentDocs.length} student records`);

  // Create matching User accounts for each student
  const studentUserPw = await hash('student123');
  const studentUsers = await PortalAccount.insertMany([
    {
      name: 'Aisha Malik',
      username: 'aisha.malik',
      email: 'aisha@student.com',
      password: studentUserPw,
      role: 'student', presetKey: 'student',
      isActive: true,
      studentId: studentDocs[0]._id,
    },
    {
      name: 'Rahul Verma',
      username: 'rahul.verma',
      email: 'rahul@student.com',
      password: studentUserPw,
      role: 'student', presetKey: 'student',
      isActive: true,
      studentId: studentDocs[1]._id,
    },
    {
      name: 'Emily Zhang',
      username: 'emily.zhang',
      email: 'emily@student.com',
      password: studentUserPw,
      role: 'student', presetKey: 'student',
      isActive: true,
      studentId: studentDocs[2]._id,
    },
  ]);

  // Link userId back to each student
  await Promise.all(
    studentDocs.map((s, i) => Student.findByIdAndUpdate(s._id, { userId: studentUsers[i]._id }))
  );
  console.log(`🔗  Linked ${studentUsers.length} student portal accounts`);

  const [aisha, rahul, emily] = studentDocs;
  const [aishaUser, rahulUser, emilyUser] = studentUsers;

  // ── 4. Leads ──────────────────────────────────────────────────────────────
  const leadsData = [
    { name: 'Fatima Zahra',    email: 'fatima@leads.com',   phone: '+212-661234567',  source: 'website',      status: 'new',               intendedCountry: 'UK',        intendedCourse: 'Law',             intakeYear: 2025, intakeSemester: 'September', budget: 25000 },
    { name: 'Hiroshi Tanaka',  email: 'hiroshi@leads.com',  phone: '+81-9012345678',  source: 'referral',     status: 'contacted',         intendedCountry: 'USA',       intendedCourse: 'Physics',         intakeYear: 2025, intakeSemester: 'January',   budget: 50000 },
    { name: 'Lucas Pereira',   email: 'lucas@leads.com',    phone: '+55-11987654321', source: 'social_media', status: 'counselling',       intendedCountry: 'Canada',    intendedCourse: 'Engineering',     intakeYear: 2025, intakeSemester: 'September', budget: 30000, assignedTo: counsellor1._id },
    { name: 'Ananya Singh',    email: 'ananya@leads.com',   phone: '+91-9876543210',  source: 'walk_in',      status: 'interested',        intendedCountry: 'Australia', intendedCourse: 'Nursing',         intakeYear: 2026, intakeSemester: 'February',  budget: 40000, assignedTo: counsellor2._id },
    { name: 'Mohammed Al-Sayed', email: 'mo@leads.com',     phone: '+966-501234567',  source: 'phone',        status: 'application_started', intendedCountry: 'UK',     intendedCourse: 'Finance',         intakeYear: 2025, intakeSemester: 'September', budget: 35000, assignedTo: counsellor1._id },
    { name: 'Sophie Martin',   email: 'sophie@leads.com',   phone: '+33-612345678',   source: 'email',        status: 'closed_won',        intendedCountry: 'Germany',   intendedCourse: 'Architecture',    intakeYear: 2025, intakeSemester: 'October',   budget: 20000, assignedTo: counsellor3._id },
    { name: 'Kwame Asante',    email: 'kwame@leads.com',    phone: '+233-201234567',  source: 'website',      status: 'new',               intendedCountry: 'USA',       intendedCourse: 'Medicine',        intakeYear: 2026, intakeSemester: 'August',    budget: 60000 },
    { name: 'Valentina Cruz',  email: 'valentina@leads.com', phone: '+54-91112345678', source: 'referral',    status: 'contacted',         intendedCountry: 'Spain',     intendedCourse: 'Fashion Design',  intakeYear: 2025, intakeSemester: 'September', budget: 15000 },
    { name: 'Ivan Petrov',     email: 'ivan@leads.com',     phone: '+7-9161234567',   source: 'social_media', status: 'counselling',       intendedCountry: 'Netherlands', intendedCourse: 'Computer Science', intakeYear: 2025, intakeSemester: 'September', budget: 28000, assignedTo: counsellor2._id },
    { name: 'Yuki Nakamura',   email: 'yuki@leads.com',     phone: '+81-8012345678',  source: 'walk_in',      status: 'interested',        intendedCountry: 'UK',        intendedCourse: 'Art & Design',    intakeYear: 2026, intakeSemester: 'September', budget: 22000, assignedTo: counsellor3._id },
    { name: 'Amara Diallo',    email: 'amara@leads.com',    phone: '+221-771234567',  source: 'other',        status: 'closed_lost',       intendedCountry: 'France',    intendedCourse: 'Economics',       intakeYear: 2025, intakeSemester: 'October',   budget: 18000, notes: 'Could not secure finances' },
    { name: 'Chen Wei',        email: 'chenwei@leads.com',  phone: '+86-13912345678', source: 'website',      status: 'application_started', intendedCountry: 'USA',    intendedCourse: 'MBA',             intakeYear: 2025, intakeSemester: 'August',    budget: 55000, assignedTo: counsellor1._id },
  ] as const;

  const leads = await Lead.insertMany(leadsData);
  console.log(`📋  Created ${leads.length} leads`);

  // ── 5. Applications (Aisha — visa_filing stage, most complete) ───────────
  const aishaApps = await Application.insertMany([
    {
      studentId:   aisha._id,
      university:  'University of Manchester',
      country:     'UK',
      course:      'MSc Computer Science',
      level:       'postgraduate',
      intake:      'September 2025',
      status:      'accepted',
      appliedDate: daysAgo(90),
      offerDate:   daysAgo(45),
      tuitionFee:  28000,
      currency:    'GBP',
      notes:       'Unconditional offer received. CAS requested.',
    },
    {
      studentId:   aisha._id,
      university:  'University of Edinburgh',
      country:     'UK',
      course:      'MSc Data Science',
      level:       'postgraduate',
      intake:      'September 2025',
      status:      'conditional_offer',
      appliedDate: daysAgo(85),
      offerDate:   daysAgo(30),
      deadline:    daysAhead(14),
      tuitionFee:  26500,
      currency:    'GBP',
      notes:       'Conditional on final transcript submission.',
    },
    {
      studentId:   aisha._id,
      university:  'University of Leeds',
      country:     'UK',
      course:      'MSc Artificial Intelligence',
      level:       'postgraduate',
      intake:      'September 2025',
      status:      'rejected',
      appliedDate: daysAgo(100),
      tuitionFee:  24000,
      currency:    'GBP',
    },
  ]);

  // Applications for Rahul — offer_letter stage
  const rahulApps = await Application.insertMany([
    {
      studentId:   rahul._id,
      university:  'University of Melbourne',
      country:     'Australia',
      course:      'MBA',
      level:       'postgraduate',
      intake:      'February 2025',
      status:      'offer_received',
      appliedDate: daysAgo(70),
      offerDate:   daysAgo(20),
      tuitionFee:  45000,
      currency:    'AUD',
      notes:       'Merit scholarship applied for.',
    },
    {
      studentId:   rahul._id,
      university:  'RMIT University',
      country:     'Australia',
      course:      'Master of Business Analytics',
      level:       'postgraduate',
      intake:      'February 2025',
      status:      'submitted',
      appliedDate: daysAgo(60),
      deadline:    daysAhead(7),
      tuitionFee:  38000,
      currency:    'AUD',
    },
  ]);

  // Application for Emily — early stage
  await Application.insertMany([
    {
      studentId:   emily._id,
      university:  'Imperial College London',
      country:     'UK',
      course:      'BEng Electrical Engineering',
      level:       'undergraduate',
      intake:      'September 2025',
      status:      'drafting',
      tuitionFee:  33000,
      currency:    'GBP',
    },
  ]);

  console.log(`🏫  Created ${aishaApps.length + rahulApps.length + 1} applications`);

  // ── 6. Visas ──────────────────────────────────────────────────────────────
  const visas = await Visa.insertMany([
    {
      studentId:   aisha._id,
      country:     'UK',
      visaType:    'Tier 4 Student Visa',
      stage:       'visa_filed',
      filedDate:   daysAgo(10),
      notes:       'Biometrics appointment scheduled for next week.',
    },
    {
      studentId:   rahul._id,
      country:     'Australia',
      visaType:    'Student Visa (Subclass 500)',
      stage:       'not_started',
      notes:       'Waiting for final offer letter before starting visa process.',
    },
  ]);
  console.log(`🛂  Created ${visas.length} visa records`);

  // ── 7. Payments ───────────────────────────────────────────────────────────
  const payments = await Payment.insertMany([
    // Aisha
    {
      studentId:     aisha._id,
      type:          'service_fee',
      description:   'CRM Counselling & Application Service Fee',
      amount:        1500,
      currency:      'USD',
      status:        'paid',
      paidDate:      daysAgo(60),
      invoiceNumber: 'INV-2025-001',
      createdBy:     admin._id,
    },
    {
      studentId:     aisha._id,
      type:          'application_fee',
      description:   'University of Manchester Application Fee',
      amount:        80,
      currency:      'GBP',
      status:        'paid',
      paidDate:      daysAgo(90),
      invoiceNumber: 'INV-2025-002',
      createdBy:     admin._id,
    },
    {
      studentId:     aisha._id,
      type:          'visa_fee',
      description:   'UK Tier 4 Student Visa Fee',
      amount:        490,
      currency:      'GBP',
      status:        'paid',
      paidDate:      daysAgo(12),
      invoiceNumber: 'INV-2025-003',
      createdBy:     admin._id,
    },
    {
      studentId:     aisha._id,
      type:          'university_fee',
      description:   'University of Manchester — Tuition Deposit',
      amount:        5000,
      currency:      'GBP',
      status:        'pending',
      dueDate:       daysAhead(30),
      invoiceNumber: 'INV-2025-004',
      createdBy:     admin._id,
    },
    // Rahul
    {
      studentId:     rahul._id,
      type:          'service_fee',
      description:   'CRM Application Service Fee',
      amount:        1200,
      currency:      'USD',
      status:        'paid',
      paidDate:      daysAgo(50),
      invoiceNumber: 'INV-2025-005',
      createdBy:     admin._id,
    },
    {
      studentId:     rahul._id,
      type:          'application_fee',
      description:   'University of Melbourne Application Fee',
      amount:        100,
      currency:      'AUD',
      status:        'paid',
      paidDate:      daysAgo(70),
      invoiceNumber: 'INV-2025-006',
      createdBy:     admin._id,
    },
    {
      studentId:     rahul._id,
      type:          'university_fee',
      description:   'University of Melbourne — Acceptance Deposit',
      amount:        3000,
      currency:      'AUD',
      status:        'overdue',
      dueDate:       daysAgo(5),
      invoiceNumber: 'INV-2025-007',
      createdBy:     admin._id,
    },
    // Emily
    {
      studentId:     emily._id,
      type:          'service_fee',
      description:   'Initial Counselling Fee',
      amount:        500,
      currency:      'USD',
      status:        'pending',
      dueDate:       daysAhead(15),
      invoiceNumber: 'INV-2025-008',
      createdBy:     admin._id,
    },
  ]);
  console.log(`💳  Created ${payments.length} payment records`);

  // ── 8. Documents ──────────────────────────────────────────────────────────
  // Synthetic file URLs (no physical files needed for seed)
  const mkVer = (name: string, daysBack: number) => ({
    fileUrl:    `/uploads/seed_${name.replace(/\s+/g, '_').toLowerCase()}.pdf`,
    fileName:   name,
    uploadedAt: daysAgo(daysBack),
    uploadedBy: aishaUser._id,
  });

  const documents = await DocumentModel.insertMany([
    // Aisha — mix of statuses
    {
      studentId:      aisha._id,
      type:           'passport',
      label:          'Passport (Valid)',
      status:         'approved',
      currentVersion: mkVer('Aisha_Passport.pdf', 80),
      versions:       [mkVer('Aisha_Passport.pdf', 80)],
      reviewedBy:     admin._id,
    },
    {
      studentId:      aisha._id,
      type:           'ielts',
      label:          'IELTS Score Card — 7.0',
      status:         'approved',
      currentVersion: mkVer('Aisha_IELTS.pdf', 75),
      versions:       [mkVer('Aisha_IELTS.pdf', 75)],
      reviewedBy:     admin._id,
    },
    {
      studentId:      aisha._id,
      type:           'sop',
      label:          'Statement of Purpose',
      status:         'under_review',
      currentVersion: mkVer('Aisha_SOP_v2.pdf', 5),
      versions:       [mkVer('Aisha_SOP_v1.pdf', 20), mkVer('Aisha_SOP_v2.pdf', 5)],
    },
    {
      studentId:        aisha._id,
      type:             'bank_statement',
      label:            'Bank Statement (6 months)',
      status:           'rejected',
      currentVersion:   mkVer('Aisha_Bank_Statement.pdf', 15),
      versions:         [mkVer('Aisha_Bank_Statement.pdf', 15)],
      reviewedBy:       admin._id,
      rejectionReason:  'Statement must be less than 3 months old. Please upload a recent one.',
    },
    // Rahul
    {
      studentId:      rahul._id,
      type:           'passport',
      label:          'Passport',
      status:         'approved',
      currentVersion: { fileUrl: '/uploads/seed_rahul_passport.pdf', fileName: 'Rahul_Passport.pdf', uploadedAt: daysAgo(65), uploadedBy: rahulUser._id },
      versions:       [{ fileUrl: '/uploads/seed_rahul_passport.pdf', fileName: 'Rahul_Passport.pdf', uploadedAt: daysAgo(65), uploadedBy: rahulUser._id }],
      reviewedBy:     admin._id,
    },
    {
      studentId:      rahul._id,
      type:           'gmat',
      label:          'GMAT Score Report — 680',
      status:         'approved',
      currentVersion: { fileUrl: '/uploads/seed_rahul_gmat.pdf', fileName: 'Rahul_GMAT.pdf', uploadedAt: daysAgo(60), uploadedBy: rahulUser._id },
      versions:       [{ fileUrl: '/uploads/seed_rahul_gmat.pdf', fileName: 'Rahul_GMAT.pdf', uploadedAt: daysAgo(60), uploadedBy: rahulUser._id }],
      reviewedBy:     admin._id,
    },
    // Emily
    {
      studentId:      emily._id,
      type:           'marksheet_12',
      label:          '12th Grade Marksheet',
      status:         'uploaded',
      currentVersion: { fileUrl: '/uploads/seed_emily_marksheet12.pdf', fileName: 'Emily_12th_Marksheet.pdf', uploadedAt: daysAgo(3), uploadedBy: emilyUser._id },
      versions:       [{ fileUrl: '/uploads/seed_emily_marksheet12.pdf', fileName: 'Emily_12th_Marksheet.pdf', uploadedAt: daysAgo(3), uploadedBy: emilyUser._id }],
    },
  ]);
  console.log(`📄  Created ${documents.length} document records`);

  // ── 9. Notifications ──────────────────────────────────────────────────────
  await Notification.insertMany([
    // Aisha
    {
      userId:  aishaUser._id,
      type:    'document',
      title:   'Bank Statement Rejected',
      body:    'Your bank statement was rejected. Please upload a recent statement (less than 3 months old).',
      link:    '/documents',
      read:    false,
    },
    {
      userId:  aishaUser._id,
      type:    'application',
      title:   'Offer Received — University of Manchester 🎉',
      body:    'Congratulations! You have received an unconditional offer from University of Manchester for MSc Computer Science.',
      link:    '/applications',
      read:    true,
    },
    {
      userId:  aishaUser._id,
      type:    'visa',
      title:   'Visa Application Filed',
      body:    'Your UK Tier 4 Student Visa application has been filed. We will notify you of any updates.',
      link:    '/progress',
      read:    true,
    },
    {
      userId:  aishaUser._id,
      type:    'payment',
      title:   'Payment Due in 30 Days',
      body:    'A tuition deposit of £5,000 for University of Manchester is due in 30 days.',
      link:    '/payments',
      read:    false,
    },
    {
      userId:  aishaUser._id,
      type:    'stage',
      title:   'Stage Updated: Visa Filing',
      body:    'Your journey has progressed to the Visa Filing stage. Great work!',
      read:    true,
    },
    // Rahul
    {
      userId:  rahulUser._id,
      type:    'application',
      title:   'Offer Received — University of Melbourne',
      body:    'You have received an offer from the University of Melbourne for MBA. Please review the offer conditions.',
      link:    '/applications',
      read:    false,
    },
    {
      userId:  rahulUser._id,
      type:    'payment',
      title:   'Payment Overdue ⚠️',
      body:    'Your acceptance deposit of AUD 3,000 for University of Melbourne is overdue. Please contact your counsellor.',
      link:    '/payments',
      read:    false,
    },
    // Emily
    {
      userId:  emilyUser._id,
      type:    'general',
      title:   'Welcome to StudyPortal! 👋',
      body:    "Your account has been set up. You've been assigned to counsellor Priya Sharma. Feel free to reach out via chat anytime.",
      link:    '/home',
      read:    false,
    },
    {
      userId:  emilyUser._id,
      type:    'document',
      title:   'Please Upload Your Documents',
      body:    'To proceed with your university applications, please upload your passport, IELTS score card, and 12th grade marksheet.',
      link:    '/documents',
      read:    false,
    },
  ]);
  console.log(`🔔  Created notifications`);

  // ── 10. Conversations + Messages (Aisha ↔ Sarah) ─────────────────────────
  const conv = await Conversation.create({
    participants: [aishaUser._id, counsellor1._id],
    studentId:    aisha._id,
  });

  const chatScript = [
    { sender: counsellor1,  name: 'Sarah Thompson', text: "Hi Aisha! Congratulations on your University of Manchester offer 🎉 How are you feeling?",           daysBack: 12 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "Thank you so much Sarah! I'm so excited. What do I need to do next?",                                daysBack: 12 },
    { sender: counsellor1,  name: 'Sarah Thompson', text: "Great! First priority is the bank statement — it was rejected. Please upload one dated within 3 months.", daysBack: 11 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "Oh no! I'll get a fresh one from the bank today and upload it right away.",                           daysBack: 11 },
    { sender: counsellor1,  name: 'Sarah Thompson', text: "Perfect. Once that's approved, we'll proceed with the CAS request from Manchester.",                  daysBack: 10 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "Sounds good. Also, the Edinburgh conditional offer — do I need to accept it now?",                    daysBack: 9  },
    { sender: counsellor1,  name: 'Sarah Thompson', text: "You have a deadline in 14 days. I recommend accepting Manchester first since it's unconditional. I'll email you a full comparison sheet.", daysBack: 9 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "That would be amazing, thank you! You've been so helpful throughout this whole process.",             daysBack: 8  },
    { sender: counsellor1,  name: 'Sarah Thompson', text: "That's what we're here for 😊 I've also submitted your visa application today. Keep an eye on your email for the biometrics appointment letter.", daysBack: 5 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "Perfect! I'll watch out for it. When should I expect a decision?",                                   daysBack: 5  },
    { sender: counsellor1,  name: 'Sarah Thompson', text: "Typically 3–8 weeks for a Tier 4 visa. I'll keep you posted on any updates. You're doing great, Aisha!", daysBack: 4 },
    { sender: aishaUser,    name: 'Aisha Malik',     text: "Thank you Sarah! I'll upload that bank statement today.",                                             daysBack: 1  },
  ];

  const msgDocs = await Message.insertMany(
    chatScript.map(m => ({
      conversationId: conv._id,
      senderId:       m.sender._id,
      senderName:     m.name,
      type:           'text',
      text:           m.text,
      readBy:         [m.sender._id],
      createdAt:      daysAgo(m.daysBack),
    }))
  );

  // Update conversation's last message
  const lastMsg = chatScript[chatScript.length - 1];
  await Conversation.findByIdAndUpdate(conv._id, {
    lastMessage: {
      text:      lastMsg.text,
      senderId:  aishaUser._id,
      createdAt: daysAgo(1),
    },
    updatedAt: daysAgo(1),
  });

  console.log(`💬  Created 1 conversation with ${msgDocs.length} messages`);

  // ── 11. Summary ───────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  Seed complete! Login credentials:\n');
  // Printed from the seeded records rather than a hand-written list, so the
  // credentials can never drift from what was actually created.
  const handle = (u: { username?: string; email?: string; role: string }) =>
    usesEmailLogin(u.role as UserRole) ? u.email! : u.username!;

  console.log('  STAFF  (password: password123)');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('  the admin signs in with an email address, every other role with a username\n');
  for (const u of staffData.filter(x => x.role !== 'university')) {
    console.log(`  ${u.role.replace(/_/g, ' ').padEnd(19)} →  ${handle(u)}`);
  }

  console.log('\n  UNIVERSITY PARTNERS  (password: password123)');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const u of staffData.filter(x => x.role === 'university')) {
    console.log(`  ${(u.universityName ?? u.name).padEnd(24)} →  ${handle(u)}`);
  }

  console.log('\n  STUDENTS  (password: student123)');
  console.log('  ─────────────────────────────────────────────────────────');
  studentUsers.forEach((u: { name: string; username?: string }, i: number) => {
    console.log(`  ${u.name.padEnd(13)} (${studentDocs[i].stage.padEnd(13)}) →  ${u.username}`);
  });
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('\n❌  Seed failed:', err);
  process.exit(1);
});
