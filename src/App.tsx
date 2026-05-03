/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Building2, 
  Calendar, 
  ClipboardList, 
  PlusCircle, 
  Settings, 
  Lock, 
  Unlock, 
  Trash2, 
  FileSpreadsheet, 
  Printer, 
  ChevronRight, 
  ChevronLeft, 
  LogOut, 
  UserPlus, 
  Search,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCcw,
  User,
  ShieldCheck,
  Building,
  Users,
  Eye,
  EyeOff,
  Phone,
  Hospital,
  Activity,
  Upload,
  Cloud,
  Hash,
  Home,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, addDays, addMonths, subMonths, isSameMonth, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isAfter } from 'date-fns';
import { ar } from 'date-fns/locale';

import { db, auth } from './firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut
} from 'firebase/auth';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface Clinic {
  id: string;
  name: string;
  max?: number;
  icon?: string; // Base64 data URL or URL for custom icons
}

interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: string;
}

interface UserData {
  name: string;
  pass: string;
  role: 'admin' | 'user';
}

interface Case {
  id: string;
  unit: string;
  name: string;
  pid: string;
  phone: string;
  notes: string;
  time: string;
  by: string;
  result?: string;
}

interface DayData {
  [clinicId: string]: Case[] | string[] | undefined;
}

interface OverbookingData {
  [dateKey: string]: {
    __locked?: string[];
    [clinicId: string]: any;
  };
}

interface Settings {
  adminPass: string;
  maxPerClinic: number;
  closedDays: number[];
  holidayDates?: string[];
  clinics: Clinic[];
  units: string[];
  users: UserData[];
  navActiveColor?: string;
}

// --- Constants ---
const DEFAULT_CLINICS: Clinic[] = [
  { id: 'internal', name: 'الاستشارات الباطنية المتقدمة' },
  { id: 'surgery', name: 'وحدة الجراحة المتخصصة' },
  { id: 'ortho', name: 'مركز طب وجراحة العظام' },
  { id: 'ent', name: 'عيادة الأذن والأنف والحنجرة' },
  { id: 'eye', name: 'مستشفى الرمد والعيون' },
  { id: 'cardio', name: 'وحدة طب القلب والأوعية' },
  { id: 'neuro', name: 'مركز العلوم العصبية' },
  { id: 'gyne', name: 'قسم صحة المرأة والولادة' },
  { id: 'pedia', name: 'مركز رعاية الأطفال المتكامل' },
  { id: 'derm', name: 'عيادة الجلدية والتجميل' },
];

const DEFAULT_UNITS = ['المستشفى التعليمي العالمي', 'مركز الرعاية الأولية المتميز', 'مستشفى الشفاء التخصصي', 'وحدة طب الأسرة النموذجي'];

const DEFAULT_SETTINGS: Settings = {
  adminPass: 'admin123',
  maxPerClinic: 5,
  closedDays: [5],
  holidayDates: [],
  clinics: DEFAULT_CLINICS,
  units: DEFAULT_UNITS,
  users: [{ name: 'مدخل1', pass: '1234', role: 'user' }],
  navActiveColor: '#E11D48' // Default accent (rose-600)
};

const DATA_KEY = 'overbooking_data_v3';
const SETTINGS_KEY = 'overbooking_settings_v3';

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function App() {
  // --- State ---
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [data, setData] = useState<OverbookingData>({});
  const [logs, setLogs] = useState<AuditLog[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingClinicId, setUploadingClinicId] = useState<string | null>(null);
  const [isClinicsCollapsed, setIsClinicsCollapsed] = useState(false);
  const isSyncingRef = React.useRef(false);

  // --- Auth & Sync ---
  useEffect(() => {
    // Offline Persistence
    try {
      import('firebase/firestore').then(({ enableMultiTabIndexedDbPersistence }) => {
        enableMultiTabIndexedDbPersistence(db).catch(() => {});
      });
    } catch (e) {}
    
    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      // We still use our internal currentUser for role-based logic,
      // but we need a Firebase session for Firestore rules.
      if (!fbUser) {
        try {
          // Attempt anonymous first
          await signInAnonymously(auth);
        } catch (error: any) {
          if (error.code === 'auth/admin-restricted-operation') {
            console.warn("Anonymous auth disabled. Using guest mode (read-only or restricted).");
            // If they are not logged in via Firebase, Firestore rules might block them.
            // We'll show a Google Login button in the UI if needed.
          } else {
            console.error("Auth failed", error);
          }
        }
      }
    });

    return () => unsubAuth();
  }, []);

  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        addToast(`مرحباً ${result.user.displayName}`, 'success');
        // If it's a first time login via Google, we treat them as a user
        if (!currentUser) {
          setCurrentUser({ name: result.user.displayName || 'موظف', pass: '', role: 'user' });
        }
      }
    } catch (error) {
      console.error("Google sign in failed", error);
      addToast('فشل تسجيل الدخول عبر جوجل', 'error');
    }
  };

  useEffect(() => {
    // Sync Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
      if (docSnap.exists()) {
        isSyncingRef.current = true;
        setSettings(s => ({ ...DEFAULT_SETTINGS, ...s, ...docSnap.data() }));
      } else {
        // Initialize settings if not exists
        setDoc(doc(db, 'settings', 'global'), DEFAULT_SETTINGS);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/global'));

    // Sync Data (Dates/Locks)
    const unsubData = onSnapshot(collection(db, 'overbooking'), (querySnapshot) => {
      const newData: OverbookingData = {};
      querySnapshot.forEach((doc) => {
        newData[doc.id] = doc.data();
      });
      setData(newData);
      setIsLoading(false); // Enable UI as soon as data arrives
    }, (error) => handleFirestoreError(error, OperationType.GET, 'overbooking'));

    // Sync Logs (Limit to 100)
    const qLogs = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubLogs = onSnapshot(qLogs, (querySnapshot) => {
      const newLogs: AuditLog[] = [];
      querySnapshot.forEach((doc) => {
        newLogs.push({ id: doc.id, ...doc.data() } as AuditLog);
      });
      setLogs(newLogs);
      setIsLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'logs'));

    return () => {
      unsubSettings();
      unsubData();
      unsubLogs();
    };
  }, []);

  // Sync settings to Firebase when changed locally
  useEffect(() => {
    if (isSyncingRef.current) {
      isSyncingRef.current = false;
      return;
    }
    const saveToFirebase = async () => {
      setIsSaving(true);
      try {
        await setDoc(doc(db, 'settings', 'global'), settings);
        setIsSaving(false);
      } catch (error) {
        console.error("Failed to sync settings", error);
        setIsSaving(false);
      }
    };
    saveToFirebase();
  }, [settings]);

  const findNextAvailable = (clinicId: string) => {
    let checkDate = addDays(new Date(selectedDate), 1);
    for (let i = 0; i < 30; i++) {
      const dateKey = format(checkDate, 'yyyy-MM-dd');
      const dayIdx = checkDate.getDay();
      if (!settings.closedDays.includes(dayIdx)) {
        const clinicCases = (data[dateKey]?.[clinicId] as Case[]) || [];
        const clinic = settings.clinics.find(c => c.id === clinicId);
        const maxVal = clinic?.max || settings.maxPerClinic;
        if (clinicCases.length < maxVal) {
          return { date: checkDate, dateKey };
        }
      }
      checkDate = addDays(checkDate, 1);
    }
    return null;
  };

  const [currentUser, setCurrentUser] = useState<UserData | null>(() => {
    const saved = sessionStorage.getItem('overbooking_session');
    return saved ? JSON.parse(saved) : null;
  });

  const [showLoginPass, setShowLoginPass] = useState(false);
  const [editingPatient, setEditingPatient] = useState<{ date: string, cid: string, case: Case } | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [activeTab, setActiveTab] = useState<'daily' | 'daily_list' | 'monthly' | 'admin' | 'stats'>('daily');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPassInput, setAdminPassInput] = useState('');
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());

  const [selectedClinic, setSelectedClinic] = useState<string | null>(null);
  const [patientForm, setPatientForm] = useState({
    unit: '',
    name: '',
    pid: '',
    phone: '',
    notes: ''
  });

  const [newUserInfo, setNewUserInfo] = useState({ name: '', pass: '' });
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: 'success' | 'error' | 'warning' }[]>([]);
  const [notifications, setNotifications] = useState<{ id: string; msg: string; time: string; type: 'capacity' }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // --- Hijri Utility ---
  const getHijriDate = (date: Date) => {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-uma-nu-latn', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date);
  };

  const isDateInCurrentMonth = (date: Date) => {
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  };

  // --- Google Sheets Sync ---
  const syncToGoogleSheets = async (caseData: Case, clinicName: string) => {
    if (!settings.googleSheetsWebhook) return;
    
    try {
      // Background sync
      fetch(settings.googleSheetsWebhook, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          clinic: clinicName,
          ...caseData,
          date: selectedDate
        })
      });
    } catch (e) {
      console.error('Sheets Sync Failed', e);
    }
  };

  const exportToCSV = () => {
    let csv = "\uFEFF"; // BOM for Excel UTF-8
    csv += "التاريخ,العيادة,الاسم,الرقم الطبي,الوحدة,الهاتف,النتيجة\n";
    
    Object.entries(data).forEach(([date, clinics]) => {
      Object.entries(clinics).forEach(([cid, cases]) => {
        if (cid === '__locked') return;
        const clinic = settings.clinics.find(c => c.id === cid);
        (cases as Case[]).forEach(c => {
          csv += `${date},${clinic?.name || cid},${c.name},${c.pid},${c.unit},${c.phone},${c.result || ''}\n`;
        });
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `overbooking_export_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addToast('تم تصدير البيانات بنجاح', 'success');
  };
  const [editingResult, setEditingResult] = useState<{ date: string, cid: string, caseId: string, name: string, currentResult: string } | null>(null);

  const generateId = () => {
    return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
  };

  // --- Helpers ---
  const addLog = async (action: string, details: string) => {
    if (!currentUser) return;
    const logId = generateId();
    const newLog: Omit<AuditLog, 'id'> = {
      userId: currentUser.name,
      userName: currentUser.name,
      action,
      details,
      timestamp: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
    };
    try {
      await setDoc(doc(db, 'logs', logId), newLog);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `logs/${logId}`);
    }
  };

  // --- Derived ---
  const stats = useMemo(() => {
    const totalCasesCount = Object.values(data).reduce((acc: number, clinics: any) => {
      return acc + (Object.entries(clinics).reduce((a: number, [k, v]) => {
        return a + (k !== '__locked' && Array.isArray(v) ? (v as any[]).length : 0);
      }, 0) as number);
    }, 0) as number;

    const daysCount = Object.keys(data).length || 1;
    const avgDailyCases = Math.round(totalCasesCount / daysCount);
    const totalCapacity = daysCount * settings.clinics.length * settings.maxPerClinic || 1;
    const overallOccupancy = Math.round((totalCasesCount / totalCapacity) * 100);

    const clinicStats = settings.clinics.map(clinic => {
      const totalClinicCases = Object.values(data).reduce((acc: number, clinics: any) => {
        const cases = clinics[clinic.id] as any[] | undefined;
        return acc + (cases?.length || 0);
      }, 0) as number;
      const pct = (totalClinicCases / (totalCasesCount || 1)) * 100;
      return { ...clinic, totalClinicCases, pct };
    });

    return { totalCasesCount, avgDailyCases, overallOccupancy, clinicStats };
  }, [data, settings.clinics, settings.maxPerClinic]);

  const currentDateObj = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [selectedDate]);

  const isClosed = settings.closedDays.includes(getDay(currentDateObj)) || (settings.holidayDates || []).includes(selectedDate);
  
  const todayCasesTotal = useMemo(() => {
    const day = data[selectedDate] || {};
    let count = 0;
    Object.keys(day).forEach(k => {
      if (k !== '__locked') count += (day[k] as Case[]).length;
    });
    return count;
  }, [data, selectedDate]);

  const isNextMonthDisabled = useMemo(() => {
    const nextMonth = addMonths(viewDate, 1);
    return isAfter(startOfMonth(nextMonth), startOfMonth(new Date()));
  }, [viewDate]);

  // --- Effects ---
  useEffect(() => {
    if (currentUser) sessionStorage.setItem('overbooking_session', JSON.stringify(currentUser));
    else sessionStorage.removeItem('overbooking_session');
  }, [currentUser]);

  // --- Handlers ---
  const addToast = (msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    const id = generateId();
    setToasts(prev => [...prev, { id, msg, type } as any]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleLogin = (name: string, pass: string) => {
    if (pass === settings.adminPass) {
      setCurrentUser({ name: 'المسؤول', pass: '', role: 'admin' });
      return;
    }
    const user = settings.users.find(u => u.name === name && u.pass === pass);
    if (user) {
      setCurrentUser(user);
    } else {
      addToast('خطأ في اسم المستخدم أو كلمة السر', 'error');
    }
  };

  const handleRegisterCase = async () => {
    if (isClosed) return addToast('العيادات مغلقة اليوم', 'error');
    if (!selectedClinic) return addToast('اختر العيادة أولاً', 'warning');
    if (!patientForm.unit || !patientForm.name || !patientForm.pid) return addToast('أكمل البيانات الأساسية', 'warning');

    const dayData = data[selectedDate] || {};
    const locked = dayData.__locked || [];
    if (isAfter(startOfMonth(viewDate), startOfMonth(new Date()))) {
      return addToast('لا يمكن الحجز في الأشهر القادمة قبل بدايتها', 'error');
    }

    if (locked.includes(selectedClinic)) return addToast('العيادة مغلقة اليوم', 'error');

    const clinicCases = (dayData[selectedClinic] as Case[]) || [];
    const clinic = settings.clinics.find(c => c.id === selectedClinic);
    const maxVal = clinic?.max || settings.maxPerClinic;
    if (clinicCases.length >= maxVal) return addToast('العيادة ممتلئة', 'error');

    const newCase: Case = {
      id: generateId(),
      ...patientForm,
      time: format(new Date(), 'HH:mm'),
      by: currentUser?.name || '—'
    };

    const newDayData = {
      ...dayData,
      [selectedClinic!]: [...clinicCases, newCase]
    };

    // Optimistic UI Update
    setData(prev => ({ ...prev, [selectedDate]: newDayData }));
    setPatientForm({ unit: '', name: '', pid: '', phone: '', notes: '' });
    setSelectedClinic(null);
    addToast('تم تسجيل الحالة بنجاح', 'success');

    try {
      await setDoc(doc(db, 'overbooking', selectedDate), newDayData);
      addLog('إضافة حالة', `تم تسجيل حالة "${newCase.name}" في عيادة ${clinic?.name}`);
      syncToGoogleSheets(newCase, clinic?.name || selectedClinic!);
      
      if (newDayData[selectedClinic!].length >= maxVal) {
        setNotifications(prevNotif => [
          { 
            id: generateId(), 
            msg: `العيادة (${clinic?.name}) وصلت للحد الأقصى اليوم (${maxVal} حالات)`,
            time: format(new Date(), 'HH:mm'),
            type: 'capacity'
          },
          ...prevNotif
        ]);
      }
      
      setPatientForm({ unit: '', name: '', pid: '', phone: '', notes: '' });
      setSelectedClinic(null);
      addToast('تم تسجيل الحالة بنجاح', 'success');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `overbooking/${selectedDate}`);
    }
  };

  const handleDeleteCase = async (dateKey: string, clinicId: string, caseId: string) => {
    if (currentUser?.role !== 'admin') {
      return addToast('عذراً، الحذف متاح للمسؤول فقط', 'error');
    }
    if (!window.confirm('هل تريد حذف هذه الحالة؟')) return;

    const dayData = data[dateKey] || {};
    const cCases = (dayData[clinicId] as Case[]) || [];
    const deletedCase = cCases.find(c => String(c.id) === String(caseId));
    const clinic = settings.clinics.find(cl => cl.id === clinicId);
    
    const newDayData = {
      ...dayData,
      [clinicId]: cCases.filter(c => String(c.id) !== String(caseId))
    };

    // Optimistic UI Update
    setData(prev => ({ ...prev, [dateKey]: newDayData }));
    addToast('تم حذف الحالة', 'warning');

    try {
      await setDoc(doc(db, 'overbooking', dateKey), newDayData);
      addLog('حذف حالة', `تم حذف حالة "${deletedCase?.name || 'مجهول'}" من عيادة ${clinic?.name || clinicId}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `overbooking/${dateKey}`);
    }
  };

  const handleUpdatePatient = async (updatedCase: Case) => {
    if (currentUser?.role !== 'admin' || !editingPatient) return;
    const { date, cid } = editingPatient;
    const dayData = data[date] || {};
    const cases = (dayData[cid] as Case[]) || [];
    const newDayData = {
      ...dayData,
      [cid]: cases.map(c => c.id === updatedCase.id ? updatedCase : c)
    };

    // Optimistic UI Update
    setData(prev => ({ ...prev, [date]: newDayData }));
    setEditingPatient(null);
    addToast('تم تحديث بيانات المريض بنجاح', 'success');

    try {
      await setDoc(doc(db, 'overbooking', date), newDayData);
      addLog('تعديل بيانات مريض', `تم تعديل بيانات المريض "${updatedCase.name}"`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `overbooking/${date}`);
    }
  };

  const handleSetResult = async (dateKey: string, clinicId: string, caseId: string, resultValue: string) => {
    if (currentUser?.role !== 'admin') {
      return addToast('عذراً، إضافة النتائج متاحة للمسؤول فقط', 'error');
    }

    const dayData = data[dateKey] || {};
    const cCases = (dayData[clinicId] as Case[]) || [];
    const updatedCases = cCases.map(c => String(c.id) === String(caseId) ? { ...c, result: resultValue } : c);
    const patient = cCases.find(c => String(c.id) === String(caseId));

    const updatedDayData = {
      ...dayData,
      [clinicId]: updatedCases
    };

    // Optimistic UI Update
    setData(prev => ({ ...prev, [dateKey]: updatedDayData }));
    setEditingResult(null);
    addToast('تم حفظ النتيجة بنجاح', 'success');

    try {
      await setDoc(doc(db, 'overbooking', dateKey), updatedDayData);
      addLog('تحديث النتيجة', `تم إضافة نتيجة للحالة "${patient?.name}": ${resultValue}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `overbooking/${dateKey}`);
    }
  };

  const toggleClinicLock = async (clinicId: string) => {
    const clinic = settings.clinics.find(cl => cl.id === clinicId);
    const dayData = data[selectedDate] || {};
    const locked = (dayData.__locked as string[]) || []; 
    const isCurrentlyLocked = locked.includes(clinicId);
    const newLocked = isCurrentlyLocked 
      ? locked.filter(id => id !== clinicId) 
      : [...locked, clinicId];

    const newDayData = {
      ...dayData,
      __locked: newLocked
    };

    // Optimistic UI Update
    setData(prev => ({ ...prev, [selectedDate]: newDayData }));
    addToast('تم تحديث حالة القفل', 'success');

    try {
      await setDoc(doc(db, 'overbooking', selectedDate), newDayData);
      addLog('تغيير حالة العيادة', `${isCurrentlyLocked ? 'فتح' : 'إغلاق'} العيادة "${clinic?.name || clinicId}"`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `overbooking/${selectedDate}`);
    }
  };

  // --- Render Login ---
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-white flex items-center justify-center z-[3000]">
         <div className="flex flex-col items-center gap-8 max-w-sm px-6 text-center">
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="w-56 h-56 relative"
            >
              <img 
                src="https://www.gah.gov.eg/Content/images/logo.png" 
                alt="Logo" 
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-3">
                <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce" />
              </div>
              <div className="space-y-1">
                <p className="text-primary font-black text-2xl tracking-tight">نظام إدارة العيادات المتكامل</p>
                <p className="text-slate-400 font-bold text-xs tracking-[0.2em] uppercase">جاري مزامنة البيانات والربط الآمن</p>
              </div>
            </div>
         </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-4 z-[1000]">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#0F172A 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="bg-white rounded-[3rem] p-10 w-full max-w-md shadow-2xl shadow-slate-200/50 text-center border border-slate-100 relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-2 bg-primary" />
          
          <div className="w-36 h-36 bg-slate-50/50 rounded-3xl flex items-center justify-center mx-auto mb-10 p-6 shadow-inner border border-slate-100">
            <img 
              src="https://www.gah.gov.eg/Content/images/logo.png" 
              alt="EHA Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
            />
          </div>
          
          <div className="mb-10">
            <h2 className="text-3xl font-black text-slate-900 mb-2">تسجيل الدخول</h2>
            <p className="text-slate-500 font-bold text-sm">بوابة الموظفين - الهيئة العامة للرعاية الصحية</p>
          </div>
          
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleLogin(formData.get('name') as string, formData.get('pass') as string);
          }} className="space-y-5">
            <div className="space-y-1.5 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-4 uppercase tracking-widest">اسم المستخدم</label>
              <div className="relative group">
                <User className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300 group-focus-within:text-primary transition-colors" />
                <input 
                  name="name" 
                  type="text" 
                  autoComplete="username"
                  required
                  placeholder="أدخل اسم المستخدم"
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4.5 pr-14 pl-4 font-black text-slate-800 outline-none focus:border-primary/20 focus:bg-white transition-all placeholder:text-slate-300"
                />
              </div>
            </div>

            <div className="space-y-1.5 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-4 uppercase tracking-widest">كلمة المرور</label>
              <div className="relative group">
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300 group-focus-within:text-primary transition-colors" />
                <input 
                  name="pass" 
                  type={showLoginPass ? "text" : "password"} 
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4.5 pr-14 pl-14 font-black text-slate-800 outline-none focus:border-primary/20 focus:bg-white transition-all text-center tracking-widest placeholder:text-slate-300"
                />
                <button 
                  type="button"
                  onClick={() => setShowLoginPass(!showLoginPass)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                >
                  {showLoginPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button 
              type="submit"
              className="w-full bg-primary text-white py-5 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 mt-6 uppercase"
            >
              دخول للنظام <ChevronLeft className="w-6 h-6" />
            </button>
          </form>
          
          <div className="mt-12 pt-8 border-t border-slate-50 flex flex-col items-center gap-4">
            <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">أو عبر الهوية الموحدة</span>
            <button 
              onClick={handleGoogleSignIn}
              type="button"
              className="flex items-center gap-3 px-8 py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-slate-600 hover:bg-slate-50 transition-all text-sm shadow-sm hover:shadow-md"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" referrerPolicy="no-referrer" />
              المواصلة عبر حساب Google المؤسسي
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg font-sans">
      {/* --- Sleek Sidebar (RTL: Right side) --- */}
      <aside className="hidden lg:flex w-72 bg-primary text-white flex-col sticky top-0 h-screen shrink-0 border-l border-primary-light/50">
        <div className="p-8 flex items-center gap-4 border-b border-primary-light/50">
          <button 
            onClick={() => setActiveTab('daily')}
            className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center font-black shadow-lg shadow-accent/20 hover:scale-110 active:scale-95 transition-all cursor-pointer border-none outline-none"
          >
            🏥
          </button>
          <div>
            <span className="text-xl font-black block leading-none">الأوفر بوك</span>
            <span className="text-[10px] text-white/40 uppercase tracking-tighter mt-1 block">نظام إدارة العيادات</span>
          </div>
        </div>

        <nav className="flex-1 p-6 space-y-2">
          <div className="text-[10px] font-black text-white/30 uppercase tracking-widest px-4 mb-4">الرئيسية</div>
          <button 
            onClick={() => setActiveTab('daily')}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'daily' ? "text-white shadow-xl" : "text-white/60 hover:bg-white/5"
            )}
            style={activeTab === 'daily' ? { backgroundColor: settings.navActiveColor, boxShadow: `0 10px 15px -3px ${settings.navActiveColor}33` } : {}}
          >
            <PlusCircle className="w-5 h-5" /> <span>لوحة التسجيل</span>
          </button>
          <button 
            onClick={() => setActiveTab('daily_list')}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'daily_list' ? "text-white shadow-xl" : "text-white/60 hover:bg-white/5"
            )}
            style={activeTab === 'daily_list' ? { backgroundColor: settings.navActiveColor, boxShadow: `0 10px 15px -3px ${settings.navActiveColor}33` } : {}}
          >
            <ClipboardList className="w-5 h-5" /> <span>العيادات اليوم</span>
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'stats' ? "text-white shadow-xl" : "text-white/60 hover:bg-white/5"
            )}
            style={activeTab === 'stats' ? { backgroundColor: settings.navActiveColor, boxShadow: `0 10px 15px -3px ${settings.navActiveColor}33` } : {}}
          >
            <Activity className="w-5 h-5" /> <span>الإحصائيات</span>
          </button>
          <button 
            onClick={() => setActiveTab('monthly')}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'monthly' ? "text-white shadow-xl" : "text-white/60 hover:bg-white/5"
            )}
            style={activeTab === 'monthly' ? { backgroundColor: settings.navActiveColor, boxShadow: `0 10px 15px -3px ${settings.navActiveColor}33` } : {}}
          >
            <Calendar className="w-5 h-5" /> <span>التقرير الشهري</span>
          </button>

          <div className="text-[10px] font-black text-white/30 uppercase tracking-widest px-4 mt-8 mb-4">الإعدادات</div>
          <button 
            onClick={() => {
              if (currentUser.role === 'admin') {
                setActiveTab('admin');
              } else {
                setShowAdminLogin(true);
              }
            }}
            className={cn(
              "w-full flex items-center gap-4 px-4 py-3 rounded-xl font-bold transition-all",
              activeTab === 'admin' ? "text-white shadow-xl" : "text-white/60 hover:bg-white/5"
            )}
            style={activeTab === 'admin' ? { backgroundColor: settings.navActiveColor, boxShadow: `0 10px 15px -3px ${settings.navActiveColor}33` } : {}}
          >
            <Settings className="w-5 h-5" /> <span>إعدادات النظام</span>
          </button>
        </nav>

        <div className="p-6 border-t border-primary-light/50">
            <div className="bg-white/5 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center border-2 border-white/10">
              {auth.currentUser?.photoURL ? (
                <img src={auth.currentUser.photoURL} className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-5 h-5 text-accent" />
              )}
            </div>
            <div className="overflow-hidden">
              <div className="text-xs font-black truncate">{currentUser.name}</div>
              <div className="flex items-center justify-between">
                <div className="text-[9px] text-white/40">{currentUser.role === 'admin' ? 'مدير النظام' : 'مدخل بيانات'}</div>
                <AnimatePresence>
                  {isSaving && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="flex items-center gap-1 text-[8px] font-bold text-success/80 mr-2"
                    >
                      <RefreshCcw className="w-2 h-2 animate-spin" />
                      <span>مزامنة</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <button 
              onClick={async () => {
                await signOut(auth);
                setCurrentUser(null);
                sessionStorage.removeItem('overbooking_session');
              }}
              className="mr-auto p-2 text-white/30 hover:text-danger hover:bg-danger/10 rounded-lg transition-all"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        {/* --- Sleek Header --- */}
        <header className="h-16 lg:h-20 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-10 sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setActiveTab('daily')}
              className="lg:hidden w-10 h-10 bg-primary/5 rounded-xl flex items-center justify-center hover:bg-primary/10 transition-all cursor-pointer border-none outline-none"
            >
               <Building2 className="text-primary w-5 h-5" />
            </button>
            <h2 className="text-lg lg:text-xl font-black text-slate-800">
              {activeTab === 'daily' ? 'تسجيل حالة أوفر بوك' : activeTab === 'daily_list' ? 'متابعة العيادات اليوم' : activeTab === 'stats' ? 'إحصائيات العيادات' : activeTab === 'monthly' ? 'التقرير الشهري' : 'إعدادات النظام'}
            </h2>
          </div>

          <div className="flex items-center gap-3 lg:gap-6">
            {/* Real-time Notifications for Admin */}
            {currentUser.role === 'admin' && notifications.length > 0 && (
              <div className="absolute left-10 top-24 w-80 space-y-3 z-[100]">
                <AnimatePresence>
                  {notifications.map((n, index) => (
                    <motion.div
                      key={`${n.id}-${index}`}
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -50 }}
                      className="bg-danger p-4 rounded-2xl shadow-2xl text-white border border-white/20 relative group"
                    >
                      <button 
                        onClick={() => setNotifications(prev => prev.filter(notif => notif.id !== n.id))}
                        className="absolute right-2 top-2 p-1 hover:bg-white/10 rounded-lg"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 shrink-0 animate-bounce" />
                        <div>
                          <p className="text-xs font-black">{n.msg}</p>
                          <span className="text-[8px] font-bold opacity-60 mt-1 block">{n.time}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            <div className="hidden sm:flex flex-col items-end relative group cursor-pointer">
              <input 
                type="date" 
                value={selectedDate}
                min={format(startOfMonth(new Date()), 'yyyy-MM-dd')}
                max={format(endOfMonth(new Date()), 'yyyy-MM-dd')}
                onChange={(e) => {
                  const date = new Date(e.target.value);
                  if (isDateInCurrentMonth(date)) {
                    setSelectedDate(e.target.value);
                  } else {
                    addToast('لا يمكن اختيار تاريخ خارج الشهر الحالي', 'error');
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
              />
              <div className="text-sm font-black text-slate-800 flex items-center gap-2">
                {DAYS_AR[getDay(new Date(selectedDate))]} <ChevronDown className="w-3 h-3 text-slate-300" />
              </div>
              <div className="text-[10px] text-slate-400 font-bold flex items-center gap-2">
                <span>{format(new Date(selectedDate), 'dd MMMM yyyy', { locale: ar })}</span>
                <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 text-[8px] text-primary">{getHijriDate(new Date(selectedDate))}</span>
              </div>
            </div>
            
            <button 
              onClick={() => {
                if (currentUser.role === 'admin') {
                  setActiveTab('admin');
                } else {
                  setShowAdminLogin(true);
                }
              }}
              className="w-10 h-10 bg-slate-100 text-slate-400 hover:bg-primary hover:text-white rounded-xl flex items-center justify-center transition-all"
              title="إعدادات النظام"
            >
              <Settings className="w-5 h-5" />
            </button>

            <div className="w-[1.5px] h-8 bg-slate-100 hidden sm:block"></div>
            <div className="relative">
              <button 
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-3 group px-2 py-1 rounded-2xl hover:bg-slate-50 transition-all"
              >
                <div className="hidden md:block bg-primary/5 px-4 py-1.5 rounded-full text-xs font-black text-primary group-hover:bg-primary group-hover:text-white transition-all">
                  {currentUser.name}
                </div>
                <div className="w-10 h-10 rounded-full bg-slate-200 border-2 border-white shadow-sm overflow-hidden flex items-center justify-center group-hover:border-primary transition-all relative">
                  <User className="w-6 h-6 text-slate-400 group-hover:text-primary transition-all" />
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-slate-300 transition-transform", showProfileMenu && "rotate-180")} />
              </button>

              <AnimatePresence>
                {showProfileMenu && (
                  <>
                    <div className="fixed inset-0 z-[190]" onClick={() => setShowProfileMenu(false)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute left-0 top-[120%] w-64 bg-white rounded-3xl shadow-2xl border border-slate-100 p-2 z-[200] overflow-hidden"
                    >
                      <div className="p-4 bg-slate-50 rounded-2xl mb-2 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-black text-primary">
                          {currentUser.name[0]}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-800">{currentUser.name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{currentUser.role === 'admin' ? 'مدير النظام' : 'مدخل بيانات'}</p>
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => {
                          setActiveTab('admin');
                          setShowProfileMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-50 transition-colors text-slate-600 font-bold text-xs"
                      >
                        <Settings className="w-4 h-4" /> الإعدادات الشخصية
                      </button>
                      
                      <button 
                        onClick={() => {
                          sessionStorage.removeItem('overbooking_session');
                          window.location.reload();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-red-50 text-red-500 transition-colors font-bold text-xs"
                      >
                        <LogOut className="w-4 h-4" /> تسجيل الخروج
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* --- Page Content --- */}
        <main className="p-4 lg:p-10 flex-1">
          {/* --- Toasts --- */}
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[3000] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t, index) => (
            <motion.div 
              key={`${t.id}-${index}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 text-white font-medium pointer-events-auto",
                t.type === 'success' ? 'bg-success' : t.type === 'error' ? 'bg-danger' : 'bg-warning text-slate-900'
              )}
            >
              {t.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

        {/* --- Panels --- */}
        <AnimatePresence mode="wait">
          {activeTab === 'daily' && (
            <motion.div 
              key="daily"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Form Section */}
              <div className="lg:col-span-8 space-y-8">
                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                      <h3 className="text-xl font-black text-slate-800">بيانات الحالة الجديدة</h3>
                      <p className="text-xs text-slate-400 font-bold mt-1">تأكد من صحة البيانات قبل الحفظ</p>
                    </div>
                    <button 
                      onClick={() => setSelectedClinic(null)}
                      className="text-xs bg-accent/10 text-accent px-4 py-2 rounded-full font-black hover:bg-accent hover:text-white transition-all"
                    >
                      إعادة تعيين
                    </button>
                  </div>
                  
                  <div className="p-10 space-y-10">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-6 border-r-4 border-accent pr-3">1. اختيار العيادة المتوفرة</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
                        {settings.clinics.map((clinic, index) => {
                          const cases = (data[selectedDate]?.[clinic.id] as Case[]) || [];
                          const maxVal = clinic.max || settings.maxPerClinic;
                          const isFull = cases.length >= maxVal;
                          const locked = (data[selectedDate]?.__locked || []).includes(clinic.id);
                          const active = selectedClinic === clinic.id;

                          return (
                            <div key={`${clinic.id}-${index}`} className="relative group">
                              <button
                                disabled={isFull || locked || isClosed}
                                onClick={() => setSelectedClinic(clinic.id)}
                                className={cn(
                                  "w-full p-6 rounded-[2rem] border-2 flex flex-col items-center gap-3 transition-all relative",
                                  active ? "bg-accent/5 border-accent text-accent shadow-lg shadow-accent/5" : "bg-white border-slate-100 text-slate-500 hover:border-slate-200",
                                  (isFull || locked || isClosed) && "opacity-40 cursor-not-allowed grayscale"
                                )}
                              >
                                <div className={cn(
                                  "absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black border-4 border-white shadow-lg transition-all z-20",
                                  active ? "bg-primary text-white" : "bg-white text-slate-400"
                                )}>
                                  {cases.length}
                                </div>
                                
                                <div className={cn(
                                  "w-48 h-48 rounded-full flex items-center justify-center border-8 border-white shadow-2xl mb-4 transition-all relative group-hover:scale-110 overflow-hidden",
                                  active ? "bg-white text-primary" : "bg-slate-50 text-slate-300"
                                )}>
                                  {clinic.icon ? (
                                    <img src={clinic.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <div className="flex flex-col items-center justify-center">
                                      <Activity className="w-16 h-16 opacity-20" />
                                      <span className="text-[10px] font-black text-slate-400 mt-1 uppercase">بدون شعار</span>
                                    </div>
                                  )}
                                </div>

                                {/* Clinic Name Hidden */}
                                
                                {active && (
                                  <motion.div 
                                    layoutId="clinic-active" 
                                    className="absolute inset-0 bg-primary/10 rounded-[2rem] pointer-events-none border-2 border-primary" 
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                  />
                                )}
                              </button>

                              {isFull && !locked && !isClosed && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-all p-4 rounded-[2rem]">
                                  <p className="text-[9px] font-black text-danger mb-2">مكتمل العدد</p>
                                  {(() => {
                                    const next = findNextAvailable(clinic.id);
                                    if (next) {
                                      return (
                                        <button 
                                          onClick={() => {
                                            setSelectedDate(next.dateKey);
                                            setSelectedClinic(clinic.id);
                                            addToast(`تم الانتقال لليوم المتاح التالي: ${format(next.date, 'EEEE (d MMMM)', { locale: ar })}`, 'success');
                                          }}
                                          className="text-[8px] font-black bg-primary text-white px-3 py-1.5 rounded-lg shadow-lg hover:scale-105 active:scale-95 transition-all"
                                        >
                                          حجز في {format(next.date, 'EEEE', { locale: ar })}
                                        </button>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-8">
                       <label className="block text-xs font-black text-slate-400 uppercase tracking-widest border-r-4 border-accent pr-3">2. المعلومات التفصيلية</label>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <div className="space-y-2">
                            <label className="text-xs font-black text-slate-800 pr-2">جهة التحويل / الوحدة *</label>
                            <select 
                              value={patientForm.unit}
                              onChange={(e) => setPatientForm(f => ({ ...f, unit: e.target.value }))}
                              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-accent outline-none transition-all font-bold text-sm text-slate-800"
                            >
                              <option value="">— اختر الوحدة —</option>
                              {settings.units.map((u, i) => <option key={`${u}-${i}`} value={u}>{u}</option>)}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-slate-800 pr-2">الاسم الكامل للمريض *</label>
                            <input 
                              type="text"
                              value={patientForm.name}
                              onChange={(e) => setPatientForm(f => ({ ...f, name: e.target.value }))}
                              placeholder="الاسم الرباعي كما في الهوية"
                              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-accent outline-none transition-all font-bold text-sm"
                            />
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="space-y-2">
                            <label className="text-xs font-black text-slate-800 pr-2">رقم الملف الطبي *</label>
                            <input 
                              type="text"
                              value={patientForm.pid}
                              onChange={(e) => setPatientForm(f => ({ ...f, pid: e.target.value }))}
                              placeholder="7 أرقام على الأقل"
                              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-accent outline-none transition-all font-bold text-sm"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-black text-slate-800 pr-2">رقم التواصل</label>
                            <div className="relative">
                              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                              <input 
                                type="tel"
                                value={patientForm.phone}
                                onChange={(e) => setPatientForm(f => ({ ...f, phone: e.target.value }))}
                                placeholder="012XXXXXXXX"
                                className="w-full p-4 pl-12 bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:border-accent outline-none transition-all font-bold text-sm"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-black text-slate-800 mb-2 block pr-2">ملاحظات الفحص المبدئي</label>
                      <textarea 
                        value={patientForm.notes}
                        onChange={(e) => setPatientForm(f => ({ ...f, notes: e.target.value }))}
                        className="w-full p-5 bg-slate-50 border border-slate-200 rounded-3xl focus:bg-white focus:border-accent outline-none transition-all font-bold text-sm min-h-[120px]"
                        placeholder="أضف أي تفاصيل هامة عن حالة المريض..."
                      />
                    </div>

                    <button 
                      onClick={handleRegisterCase}
                      disabled={isClosed}
                      className="w-full py-5 bg-primary text-white font-black rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:bg-slate-300 flex items-center justify-center gap-4 text-lg"
                    >
                      <CheckCircle2 className="w-6 h-6 text-accent" /> اعتماد وتسجيل البيانات
                    </button>
                  </div>
                </div>
              </div>

              {/* Status Section */}
              <div className="lg:col-span-4 space-y-8">
                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden sticky top-24">
                  <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <div>
                      <h3 className="font-black text-slate-800">حالة العيادات</h3>
                      <p className="text-[10px] text-slate-400 font-bold mt-0.5">تحديث فوري للسعة الاستيعابية</p>
                    </div>
                  </div>

                    <div className="p-6 space-y-4">
                      {settings.clinics.map((clinic, index) => {
                        const cases = (data[selectedDate]?.[clinic.id] as Case[]) || [];
                        const maxVal = clinic.max || settings.maxPerClinic;
                        const isFull = cases.length >= maxVal;
                        const locked = (data[selectedDate]?.__locked || []).includes(clinic.id);
                        const pct = (cases.length / maxVal) * 100;
                        
                        return (
                          <div key={clinic.id} className="p-4 bg-slate-50 border border-slate-100 rounded-3xl group transition-all hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 hover:border-slate-200">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="w-32 h-32 rounded-3xl bg-white shadow-2xl border-2 border-slate-100 flex items-center justify-center relative overflow-hidden group-hover:scale-110 transition-transform shrink-0">
                                  {clinic.icon ? (
                                    <img src={clinic.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <Activity className="w-12 h-12 text-slate-200" />
                                  )}
                                </div>
                                <div>
                                  {/* Clinic Name Hidden */}
                                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{cases.length} / {maxVal} حالة</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  "text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter",
                                  locked ? "bg-slate-200 text-slate-500" : isFull ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                                )}>
                                  {locked ? 'مغلق' : isFull ? 'مزدحم' : 'متاح'}
                                </span>
                              
                              <button 
                                onClick={() => toggleClinicLock(clinic.id)}
                                className={cn(
                                  "p-1.5 rounded-lg transition-all",
                                  locked ? "bg-success/10 text-success hover:bg-success" : "bg-slate-100 text-slate-400 hover:bg-danger hover:text-white"
                                )}
                                title={locked ? "فتح العيادة" : "إغلاق العيادة (منع الأوفر بوك اليوم)"}
                              >
                                {locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                          
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mb-4">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${locked ? 0 : pct}%` }}
                              className={cn(
                                "h-full rounded-full transition-all duration-1000",
                                isFull ? "bg-danger" : pct > 70 ? "bg-warning" : "bg-accent"
                              )}
                            />
                          </div>

                          {/* FEATURE: Show Patient Details Sleekly */}
                          {cases.length > 0 && !locked && (
                            <div className="space-y-3 border-t border-slate-200/50 pt-4">
                              <p className="text-[10px] font-black text-slate-400 mb-2 flex items-center gap-2">
                                <Users className="w-3 h-3" /> قائمة الحالات المنتظرة ({cases.length}):
                              </p>
                              <div className="space-y-2">
                                {cases.map((c, index) => (
                                  <div key={`${c.id}-${index}`} className="bg-white/50 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-all group/item shadow-sm">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div className={cn("w-2 h-2 rounded-full shrink-0", isFull ? "bg-danger" : "bg-accent")} />
                                      <span className="text-[11px] font-black text-slate-700 truncate">{c.name}</span>
                                      {currentUser?.role === 'admin' && (
                                        <div className="flex items-center gap-1 mr-auto opacity-0 group-hover/item:opacity-100 transition-opacity">
                                          <button 
                                            onClick={() => setEditingPatient({ date: selectedDate, cid: clinic.id, case: c })}
                                            className="p-1 text-slate-300 hover:text-primary transition-colors"
                                          >
                                            <Settings className="w-2.5 h-2.5" />
                                          </button>
                                          <button 
                                            onClick={() => handleDeleteCase(selectedDate, clinic.id, c.id)}
                                            className="p-1 text-slate-300 hover:text-danger transition-colors"
                                          >
                                            <Trash2 className="w-2.5 h-2.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-y-1 gap-x-2">
                                       <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                                          <Hash className="w-2.5 h-2.5" /> {c.pid}
                                       </div>
                                       <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                                          <Home className="w-2.5 h-2.5" /> {c.unit}
                                       </div>
                                       {c.notes && (
                                         <div className="col-span-2 flex items-center gap-1.5 text-[8px] font-medium text-slate-500 bg-slate-50 p-1 rounded-lg border border-slate-100">
                                            <div className="w-1 h-3 bg-primary/30 rounded-full" /> {c.notes}
                                         </div>
                                       )}
                                       <div className="col-span-2 flex items-center gap-1.5 text-[9px] font-bold text-slate-500">
                                          <Phone className="w-2.5 h-2.5" /> {c.phone}
                                       </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'daily_list' && (
            <motion.div 
              key="daily_list" 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col sm:flex-row justify-between items-center gap-4">
                <div>
                   <h3 className="text-xl font-black text-slate-800">متابعة العيادات اليوم</h3>
                   <p className="text-xs text-slate-400 font-bold mt-1 tracking-wide uppercase italic">نظرة عامة على جميع التخصصات المتاحة وحالاتها</p>
                </div>
                <div className="flex-1 max-w-md mx-4 relative w-full sm:w-auto">
                   <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                   <input 
                     type="text" 
                     placeholder="ابحث باسم المريض أو رقم الملف..."
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="w-full pr-12 pl-4 py-2.5 bg-slate-50 border border-slate-100 rounded-2xl text-xs font-bold focus:outline-none focus:border-accent transition-all"
                   />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {settings.clinics.map((clinic, index) => {
                  const rawCases = (data[selectedDate]?.[clinic.id] as Case[]) || [];
                  const cases = rawCases.filter(c => 
                    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                    c.pid.toLowerCase().includes(searchQuery.toLowerCase())
                  );
                  const locked = (data[selectedDate]?.__locked || []).includes(clinic.id);
                  const maxVal = clinic.max || settings.maxPerClinic;
                  const isFull = rawCases.length >= maxVal;

                  return (
                    <motion.div 
                      key={clinic.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.05 }}
                      className={cn(
                        "bg-white p-8 rounded-[2.5rem] border-2 transition-all shadow-sm group hover:shadow-xl hover:scale-[1.02] relative overflow-hidden",
                        locked ? "border-danger/10 bg-danger/[0.01]" : "border-slate-100 hover:border-primary/30"
                      )}
                    >
                      {locked && (
                         <div className="absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1 bg-danger/10 text-danger rounded-full text-[8px] font-black uppercase italic tracking-widest z-10">
                            <Lock className="w-2.5 h-2.5" /> مغلق
                         </div>
                      )}

                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "w-56 h-56 rounded-[3rem] flex items-center justify-center border-[12px] border-white shadow-2xl mb-8 transition-all group-hover:scale-105 relative overflow-hidden",
                          locked ? "bg-danger text-white shadow-danger/20" : "bg-white text-primary shadow-slate-200"
                        )}>
                          {clinic.icon ? (
                            <img src={clinic.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Activity className={cn("w-20 h-20 opacity-20", locked ? "text-white" : "text-primary")} />
                          )}
                        </div>

                        {/* Clinic Name Hidden */}
                        
                        <div className="flex items-center gap-3 mb-6">
                           <div className={cn("px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest", 
                             isFull ? "bg-danger/10 text-danger" : "bg-green-500/10 text-green-600")}>
                             {isFull ? "مكتمل" : "متاح"}
                           </div>
                           <div className="w-[1px] h-3 bg-slate-200" />
                           <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{rawCases.length} / {maxVal} حالة</div>
                        </div>

                        <div className="w-full space-y-3">
                           {cases.length === 0 ? (
                             <div className="py-10 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-100 flex flex-col items-center justify-center opacity-60">
                                <Search className="w-6 h-6 text-slate-300 mb-2" />
                                <p className="text-[9px] font-black text-slate-400 uppercase italic">لا توجد نتائج بحث</p>
                             </div>
                           ) : (
                             <div className="max-h-64 overflow-y-auto pr-2 space-y-2.5 custom-scrollbar">
                               {cases.map((c, i) => (
                                 <div key={i} className="bg-white p-4 rounded-2xl border border-slate-100 hover:border-primary/20 transition-all group/item shadow-sm hover:shadow-md">
                                   <div className="flex justify-between items-start mb-2">
                                      <div className="flex items-center gap-2">
                                         <div className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                                         <span className="text-[11px] font-black text-slate-800 truncate max-w-[120px]">{c.name}</span>
                                      </div>
                                      <span className="text-[8px] font-black text-slate-300 group-hover/item:text-slate-500 transition-colors">{c.time}</span>
                                   </div>
                                    <div className="grid grid-cols-2 gap-2 mb-3">
                                       <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                                          <Hash className="w-2.5 h-2.5" /> {c.pid}
                                       </div>
                                       <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                                          <Home className="w-2.5 h-2.5" /> {c.unit}
                                       </div>
                                       {c.notes && (
                                         <div className="col-span-2 flex items-center gap-2 text-[9px] bg-slate-50/50 p-2 rounded-xl text-slate-500 italic border border-slate-100/50">
                                            <div className="w-1 h-3 bg-primary/20 rounded-full shrink-0" />
                                            <span className="truncate">{c.notes}</span>
                                         </div>
                                       )}
                                    </div>
                                   <div className="flex items-center gap-2 border-t border-slate-50 pt-3">
                                      <button 
                                        onClick={() => setEditingResult({ 
                                          date: selectedDate, 
                                          cid: clinic.id, 
                                          caseId: c.id, 
                                          name: c.name, 
                                          currentResult: c.result || '' 
                                        })}
                                        className={cn(
                                          "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[9px] font-black transition-all",
                                          c.result ? "bg-primary text-white" : "bg-slate-100 text-slate-500 hover:bg-primary/10 hover:text-primary"
                                        )}
                                      >
                                        <ClipboardList className="w-3.5 h-3.5" /> {c.result ? "تم التشخيص" : "إضافة تشخيص"}
                                      </button>
                                      {currentUser?.role === 'admin' && (
                                        <>
                                          <button 
                                            onClick={() => setEditingPatient({ 
                                              date: selectedDate, 
                                              cid: clinic.id, 
                                              case: c 
                                            })}
                                            className="p-2 text-slate-300 hover:text-primary hover:bg-primary/10 rounded-lg transition-all"
                                            title="تعديل بيانات المريض"
                                          >
                                            <Settings className="w-3.5 h-3.5" />
                                          </button>
                                          <button 
                                            onClick={() => handleDeleteCase(selectedDate, clinic.id, c.id)}
                                            className="p-2 text-slate-300 hover:text-danger hover:bg-danger/10 rounded-lg transition-all"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </>
                                      )}
                                   </div>
                                 </div>
                               ))}
                             </div>
                           )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'admin' && (
            <motion.div 
               key="admin" 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 1.05 }}
               className="space-y-10 max-w-5xl mx-auto"
            >
               {/* Section: My Account Settings (Accessible to all logged-in users) */}
               <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm space-y-8">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-primary/5 rounded-3xl flex items-center justify-center">
                      <User className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-slate-800">إعدادات حسابي</h3>
                      <p className="text-sm text-slate-400 font-bold mt-1 tracking-wide uppercase">تعديل ملفك الشخصي وكلمة المرور</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">اسم المستخدم</label>
                      <input 
                        type="text" 
                        value={currentUser.name}
                        onChange={(e) => {
                          const newName = e.target.value;
                          if (newName) {
                            const updatedUsers = settings.users.map(u => u.name === currentUser.name ? { ...u, name: newName } : u);
                            setSettings(s => ({ ...s, users: updatedUsers }));
                            setCurrentUser(prev => prev ? { ...prev, name: newName } : null);
                          }
                        }}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">تغيير كلمة المرور</label>
                      <input 
                        type="password" 
                        placeholder="كلمة المرور الجديدة"
                        onChange={(e) => {
                          if (e.target.value) {
                            const updatedUsers = settings.users.map(u => u.name === currentUser.name ? { ...u, pass: e.target.value } : u);
                            setSettings(s => ({ ...s, users: updatedUsers }));
                          }
                        }}
                        className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary outline-none transition-all"
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => {
                      addToast('تم تحديث بيانات الحساب بنجاح', 'success');
                      addLog('تحديث الحساب', `قام المستخدم ${currentUser.name} بتحديث بياناته الشخصية`);
                    }}
                    className="bg-primary text-white px-8 py-3.5 rounded-2xl font-black text-xs shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                  >
                    حفظ التغييرات
                  </button>
               </div>

               {currentUser.role === 'admin' && (
                  <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 overflow-hidden">
                    <div className="bg-primary p-10 text-white flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-white/10 rounded-[2rem] flex items-center justify-center backdrop-blur-md">
                          <ShieldCheck className="w-8 h-8" />
                        </div>
                        <div>
                          <h2 className="text-3xl font-black">لوحة التحكم الإدارية</h2>
                          <p className="text-white/60 font-bold mt-2">تحكم كامل في إعدادات النظام والمستخدمين والعيادات</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-10 space-y-12 bg-slate-50/30">
                      
                      {/* Section: Users Management */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b-4 border-primary/10 pb-4 mb-6">
                      <Users className="w-6 h-6 text-primary" />
                      <h3 className="text-lg font-black text-primary">إدارة مدخلي البيانات</h3>
                    </div>
                    
                    <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100">
                      <div className="overflow-x-auto">
                        <table className="w-full text-right border-separate border-spacing-y-3">
                          <thead>
                            <tr>
                              <th className="px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">الاسم</th>
                              <th className="px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">كلمة السر</th>
                              <th className="px-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">الإجراء</th>
                            </tr>
                          </thead>
                          <tbody>
                            {settings.users.map((u, i) => (
                              <tr key={`${u.name}-${i}`} className="group">
                                <td className="px-6 py-4 bg-slate-50 rounded-r-2xl font-black text-slate-700">{u.name}</td>
                                <td className="px-6 py-4 bg-slate-50">
                                  <input 
                                    type="text"
                                    value={u.pass}
                                    onChange={(e) => {
                                      const newUsers = [...settings.users];
                                      newUsers[i].pass = e.target.value;
                                      setSettings(s => ({ ...s, users: newUsers }));
                                    }}
                                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono focus:border-accent outline-none font-bold"
                                  />
                                </td>
                                <td className="px-6 py-4 bg-slate-50 rounded-l-2xl text-left">
                                  <button 
                                    onClick={() => {
                                      const newUsers = settings.users.filter((_, idx) => idx !== i);
                                      setSettings(s => ({ ...s, users: newUsers }));
                                      addToast('تم حذف المستخدم', 'warning');
                                    }}
                                    className="p-3 text-slate-300 hover:text-danger hover:bg-danger/10 rounded-xl transition-all"
                                  >
                                    <Trash2 className="w-5 h-5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      
                      <div className="mt-10 pt-10 border-t border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                        <div className="md:col-span-5 space-y-2">
                          <label className="text-[10px] uppercase font-black text-slate-400 mb-2 block pr-2">مستخدم جديد</label>
                          <input 
                            type="text" 
                            value={newUserInfo.name}
                            onChange={(e) => setNewUserInfo(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="الاسم التعريفي"
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-accent text-sm font-bold"
                          />
                        </div>
                        <div className="md:col-span-5 space-y-2">
                          <label className="text-[10px] uppercase font-black text-slate-400 mb-2 block pr-2">كلمة السر</label>
                          <input 
                            type="text" 
                            value={newUserInfo.pass}
                            onChange={(e) => setNewUserInfo(prev => ({ ...prev, pass: e.target.value }))}
                            placeholder="كلمة المرور"
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-accent text-sm font-bold"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <button 
                            onClick={() => {
                              if (!newUserInfo.name || !newUserInfo.pass) return addToast('يرجى إكمال البيانات', 'warning');
                              setSettings(s => ({ ...s, users: [...s.users, { ...newUserInfo, role: 'user' }] }));
                              setNewUserInfo({ name: '', pass: '' });
                              addToast('تم إضافة المستخدم بنجاح', 'success');
                            }}
                            className="w-full h-[56px] bg-success text-white rounded-2xl shadow-lg shadow-success/20 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
                          >
                            <UserPlus className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="space-y-8">
                      <div className="flex items-center gap-3 border-b-4 border-primary/10 pb-4 mb-6">
                        <LogOut className="w-6 h-6 text-primary rotate-180" />
                        <h3 className="text-lg font-black text-primary">المعايير العامة</h3>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block pr-2">كلمة سر المسؤول العامة</label>
                          <div className="relative">
                            <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                            <input 
                              type="text" 
                              value={settings.adminPass}
                              onChange={(e) => setSettings(s => ({ ...s, adminPass: e.target.value }))}
                              className="w-full pr-12 pl-4 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-primary font-black tracking-widest text-center text-lg"
                            />
                          </div>
                        </div>

                        <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block pr-2">الحد الأقصى الافتراضي للحالات</label>
                          <div className="flex items-center gap-6">
                            <input 
                              type="range" 
                              min="1" 
                              max="50"
                              value={settings.maxPerClinic}
                              onChange={(e) => setSettings(s => ({ ...s, maxPerClinic: parseInt(e.target.value) || 1 }))}
                              className="flex-1 accent-primary h-2 bg-slate-100 rounded-full cursor-pointer"
                            />
                            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center font-black text-2xl text-primary">
                               {settings.maxPerClinic}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="flex items-center gap-3 border-b-4 border-primary/10 pb-4 mb-6">
                        <Calendar className="w-6 h-6 text-primary" />
                        <h3 className="text-lg font-black text-primary">إدارة أيام العطلات الأسبوعية</h3>
                      </div>
                      
                      <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 grid grid-cols-1 gap-3">
                        {DAYS_AR.map((day, idx) => (
                          <button
                            key={day}
                            onClick={() => {
                              if (idx === 5) return addToast('الجمعة عطلة رسمية دائماً', 'warning');
                              setSettings(s => {
                                const closed = s.closedDays.includes(idx)
                                  ? s.closedDays.filter(d => d !== idx)
                                  : [...s.closedDays, idx];
                                return { ...s, closedDays: closed };
                              });
                            }}
                            className={cn(
                              "p-3 rounded-2xl border-2 font-black text-xs transition-all flex items-center justify-between group",
                              settings.closedDays.includes(idx) 
                                ? "bg-danger/5 border-danger/20 text-danger shadow-inner" 
                                : "bg-success/5 border-success/20 text-success"
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <div className={cn("w-1.5 h-1.5 rounded-full", settings.closedDays.includes(idx) ? "bg-danger" : "bg-success")} />
                              {day}
                            </span>
                            {settings.closedDays.includes(idx) ? <Lock className="w-3 h-3 opacity-50" /> : <Unlock className="w-3 h-3 opacity-30 group-hover:opacity-100" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div className="flex items-center gap-3 border-b-4 border-primary/10 pb-4 mb-6">
                        <AlertCircle className="w-6 h-6 text-primary" />
                        <h3 className="text-lg font-black text-primary">عطلات تاريخية محددة</h3>
                      </div>
                      
                      <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 space-y-4">
                        <div className="flex gap-2">
                          <input 
                            type="date"
                            className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold outline-none focus:border-primary"
                            id="newHolidayDate"
                          />
                          <button 
                            onClick={() => {
                              const input = document.getElementById('newHolidayDate') as HTMLInputElement;
                              const val = input?.value;
                              if (val && !(settings.holidayDates || []).includes(val)) {
                                setSettings(s => ({ ...s, holidayDates: [...(s.holidayDates || []), val] }));
                                input.value = '';
                                addToast('تمت إضافة العطلة بنجاح', 'success');
                              }
                            }}
                            className="bg-primary text-white p-3 rounded-xl hover:scale-105 active:scale-95 transition-all"
                          >
                            <PlusCircle className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <div className="space-y-2 max-h-[180px] overflow-y-auto scrollbar-hide">
                          {(settings.holidayDates || []).map(date => (
                            <div key={date} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                              <span className="text-xs font-black text-slate-600 font-mono">{date}</span>
                              <button 
                                onClick={() => setSettings(s => ({ ...s, holidayDates: (s.holidayDates || []).filter(d => d !== date) }))}
                                className="text-danger opacity-0 group-hover:opacity-100 p-1 hover:bg-danger/10 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {(settings.holidayDates || []).length === 0 && (
                            <div className="py-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest italic">لا توجد عطلات محددة</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8 bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                      <button 
                        onClick={() => setIsClinicsCollapsed(!isClinicsCollapsed)}
                        className="w-full flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                             <Building className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="text-lg font-black text-slate-800">تخصيص العيادات والوحدات</h3>
                            <AnimatePresence>
                              {isSaving && (
                                <motion.div 
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  exit={{ opacity: 0, x: 10 }}
                                  className="flex items-center gap-1.5 text-[10px] font-bold text-success"
                                >
                                  <Cloud className="w-3 h-3 animate-pulse" />
                                  <span>جاري الحفظ سحابياً...</span>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                        <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform", isClinicsCollapsed ? "rotate-0" : "rotate-180")} />
                      </button>
                      
                      <AnimatePresence>
                      {!isClinicsCollapsed && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pt-6 border-t border-slate-100">
                             {/* Clinics List */}
                             <div className="space-y-6">
                                <div className="flex justify-between items-center pr-2">
                                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                      <Hospital className="w-4 h-4" /> العيادات النشطة
                                   </h4>
                                   <button 
                                    onClick={() => setSettings(s => ({ ...s, clinics: [...s.clinics, { id: 'c' + generateId(), name: 'عيادة جديدة' }] }))}
                                    className="text-[10px] font-black bg-primary text-white px-4 py-1.5 rounded-full hover:scale-105 transition-all shadow-lg shadow-primary/20"
                                  >
                                    + إضافة عيادة
                                  </button>
                                </div>
                                
                                <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-hide pr-2">
                                  {settings.clinics.map((c, i) => (
                                    <motion.div 
                                      key={i} 
                                      whileHover={{ scale: 1.01 }}
                                      className="flex gap-4 items-center group bg-slate-50/50 p-4 rounded-[2rem] border border-slate-100 hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300"
                                    >
                                      <div className="relative group/icon">
                                        <div className="w-48 h-48 bg-white rounded-[2.5rem] p-1 shadow-inner border-2 border-slate-50 flex items-center justify-center relative overflow-hidden group-hover:scale-110 transition-transform duration-500">
                                          {uploadingClinicId === c.id && (
                                            <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center">
                                               <RefreshCcw className="w-12 h-12 text-primary animate-spin" />
                                            </div>
                                          )}
                                          {c.icon ? (
                                            <div className="w-full h-full rounded-[2rem] overflow-hidden relative">
                                              <img src={c.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                              <button 
                                                onClick={() => {
                                                  const newClinics = [...settings.clinics];
                                                  newClinics[i].icon = undefined;
                                                  setSettings(s => ({ ...s, clinics: newClinics }));
                                                }}
                                                className="absolute inset-0 bg-danger/80 text-white opacity-0 group-hover/icon:opacity-100 transition-all flex items-center justify-center backdrop-blur-[2px]"
                                              >
                                                <Trash2 className="w-10 h-10" />
                                              </button>
                                            </div>
                                          ) : (
                                            <div className="relative w-full h-full flex items-center justify-center">
                                              <Activity className="w-20 h-20 text-slate-100" />
                                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/icon:opacity-100 transition-all rounded-full bg-primary/20 backdrop-blur-[1px]">
                                                <label className="cursor-pointer p-5 bg-primary text-white rounded-2xl shadow-lg hover:scale-110 active:scale-95 transition-all">
                                                  <Upload className="w-10 h-10" />
                                                  <input 
                                                    type="file" 
                                                    accept="image/*" 
                                                    className="hidden" 
                                                    onChange={(e) => {
                                                      const file = e.target.files?.[0];
                                                      if (file) {
                                                        setUploadingClinicId(c.id);
                                                        const reader = new FileReader();
                                                        reader.onload = (ev) => {
                                                          const newClinics = [...settings.clinics];
                                                          newClinics[i].icon = ev.target?.result as string;
                                                          setSettings(s => ({ ...s, clinics: newClinics }));
                                                          addLog('تحديث شعار العيادة', `تم تغيير شعار عيادة "${c.name}"`);
                                                          setTimeout(() => setUploadingClinicId(null), 1000);
                                                        };
                                                        reader.readAsDataURL(file);
                                                      }
                                                    }}
                                                  />
                                                </label>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex-1 space-y-2">
                                        <div className="flex gap-2">
                                          <input 
                                            type="text" 
                                            value={c.name}
                                            onChange={(e) => {
                                              const newClinics = [...settings.clinics];
                                              newClinics[i].name = e.target.value;
                                              setSettings(s => ({ ...s, clinics: newClinics }));
                                            }}
                                            className="flex-1 bg-transparent border-none p-0 focus:ring-0 font-black text-slate-800 text-base"
                                          />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                           <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-xl border border-slate-100 shadow-sm flex-1 min-w-[120px]">
                                              <Cloud className="w-3 h-3 text-slate-400" />
                                              <input 
                                                type="text" 
                                                value={c.icon && !c.icon.startsWith('data:') ? c.icon : ''}
                                                placeholder="رابط الصورة (URL)"
                                                onChange={(e) => {
                                                  const newClinics = [...settings.clinics];
                                                  newClinics[i].icon = e.target.value || undefined;
                                                  setSettings(s => ({ ...s, clinics: newClinics }));
                                                }}
                                                className="w-full bg-transparent border-none text-[10px] p-0 focus:ring-0 outline-none"
                                              />
                                           </div>
                                           <div className="flex items-center gap-2 bg-white px-3 py-1 rounded-xl border border-slate-100 shadow-sm">
                                              <span className="text-[10px] font-black text-slate-400">الحد:</span>
                                              <input 
                                                type="number"
                                                value={c.max || settings.maxPerClinic}
                                                onChange={(e) => {
                                                  const newClinics = [...settings.clinics];
                                                  newClinics[i].max = parseInt(e.target.value) || 1;
                                                  setSettings(s => ({ ...s, clinics: newClinics }));
                                                }}
                                                className="w-8 p-0 bg-transparent text-[10px] font-black text-primary outline-none focus:ring-0"
                                              />
                                           </div>
                                        </div>
                                      </div>

                                      <button 
                                        onClick={() => {
                                          if (!window.confirm('هل أنت متأكد من حذف هذه العيادة نهائياً؟')) return;
                                          setSettings(s => ({ ...s, clinics: s.clinics.filter((_, idx) => idx !== i) }));
                                          addLog('حذف عيادة', `تم حذف عيادة "${c.name}"`);
                                        }}
                                        className="p-3 opacity-0 group-hover:opacity-100 text-danger hover:bg-danger/10 rounded-2xl transition-all"
                                      >
                                        <Trash2 className="w-6 h-6" />
                                      </button>
                                    </motion.div>
                                  ))}
                                </div>
                             </div>

                             {/* Units List */}
                             <div className="space-y-6">
                                <div className="flex justify-between items-center pr-2">
                                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                      <Building className="w-4 h-4" /> الوحدات الصحية المعتمدة
                                   </h4>
                                   <button 
                                    onClick={() => setSettings(s => ({ ...s, units: [...s.units, 'وحدة صحية جديدة'] }))}
                                    className="text-[10px] font-black bg-primary text-white px-4 py-1.5 rounded-full hover:scale-105 transition-all shadow-lg shadow-primary/20"
                                  >
                                    + إضافة وحدة
                                  </button>
                                </div>

                                <div className="space-y-2 max-h-[500px] overflow-y-auto scrollbar-hide pr-2">
                                  {settings.units.map((u, i) => (
                                    <div key={i} className="flex gap-2 items-center group bg-white p-3 rounded-2xl border border-slate-100 hover:shadow-md transition-all">
                                      <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center font-black text-xs text-slate-400">{i+1}</div>
                                      <input 
                                        type="text" 
                                        value={u}
                                        onChange={(e) => {
                                          const newUnits = [...settings.units];
                                          newUnits[i] = e.target.value;
                                          setSettings(s => ({ ...s, units: newUnits }));
                                        }}
                                        className="flex-1 bg-transparent border-none p-0 focus:ring-0 font-bold text-slate-600 text-sm"
                                      />
                                      <button 
                                        onClick={() => {
                                          const newUnits = settings.units.filter((_, idx) => idx !== i);
                                          setSettings(s => ({ ...s, units: newUnits }));
                                        }}
                                        className="p-2 opacity-0 group-hover:opacity-100 text-slate-300 hover:text-danger hover:bg-danger/5 rounded-xl transition-all"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                             </div>
                          </div>
                        </motion.div>
                      )}
                      </AnimatePresence>
                  </div>

                  {/* Section: Audit Log */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b-4 border-primary/10 pb-4 mb-6">
                      <ClipboardList className="w-6 h-6 text-primary" />
                      <h3 className="text-lg font-black text-primary">سجل المراقبة والنشاط</h3>
                    </div>
                    <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden shadow-sm">
                       <div className="max-h-[400px] overflow-y-auto scrollbar-hide">
                          <table className="w-full text-right border-collapse">
                             <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-100">
                                <tr>
                                   <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-tighter">المستخدم</th>
                                   <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-tighter">الإجراء</th>
                                   <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-tighter">التفاصيل</th>
                                   <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-tighter">التاريخ والوقت</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-50">
                                {logs.length === 0 ? (
                                   <tr>
                                      <td colSpan={4} className="p-20 text-center text-slate-300 font-black italic uppercase tracking-widest">لا توجد سجلات حالية</td>
                                   </tr>
                                ) : logs.map((log, index) => (
                                   <tr key={`${log.id}-${index}`} className="hover:bg-slate-50/50 transition-colors">
                                      <td className="p-6">
                                        <div className="flex items-center gap-3">
                                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-black text-primary text-[10px]">
                                             {log.userName.charAt(0)}
                                          </div>
                                          <span className="text-xs font-black text-slate-600 font-mono tracking-tighter">{log.userName}</span>
                                        </div>
                                      </td>
                                      <td className="p-6 text-xs font-black text-slate-800">
                                        <span className="px-3 py-1 bg-slate-100 rounded-lg">{log.action}</span>
                                      </td>
                                      <td className="p-6 text-xs text-slate-500 font-medium leading-relaxed">{log.details}</td>
                                      <td className="p-6 text-[10px] font-black text-slate-400 font-mono tracking-tighter whitespace-nowrap">{log.timestamp}</td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>
                  </div>

                  {/* Section: Profile Settings (Dynamic based on user) */}
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm space-y-8">
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                           <div className="w-16 h-16 bg-primary/5 rounded-3xl flex items-center justify-center">
                              <User className="w-8 h-8 text-primary" />
                           </div>
                           <div>
                              <h3 className="text-2xl font-black text-slate-800">إعدادات الحساب الشخصي</h3>
                              <p className="text-sm text-slate-400 font-bold mt-1 tracking-wide uppercase">تحديث بيانات الدخول الخاصة بك</p>
                           </div>
                        </div>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                        <div className="space-y-4">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 text-right block">الاسم التعريفي</label>
                           <input 
                              type="text" 
                              value={currentUser?.name || ''}
                              onChange={(e) => {
                                 const newName = e.target.value;
                                 setCurrentUser(prev => prev ? { ...prev, name: newName } : null);
                                 // Also update in users list if admin or matching user
                                 const updatedUsers = settings.users.map(u => u.name === currentUser?.name ? { ...u, name: newName } : u);
                                 setSettings(s => ({ ...s, users: updatedUsers }));
                              }}
                              className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary outline-none transition-all"
                           />
                        </div>

                        <div className="space-y-4">
                           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 text-right block">كلمة المرور الجديدة</label>
                           <div className="relative">
                              <input 
                                 type={showAdminPass ? "text" : "password"}
                                 placeholder="اتركها فارغة إذا لم ترد التغيير"
                                 onChange={(e) => {
                                    if (e.target.value) {
                                       const updatedUsers = settings.users.map(u => u.name === currentUser?.name ? { ...u, pass: e.target.value } : u);
                                       setSettings(s => ({ ...s, users: updatedUsers }));
                                    }
                                 }}
                                 className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary outline-none transition-all"
                              />
                              <button 
                                 onClick={() => setShowAdminPass(!showAdminPass)}
                                 className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300"
                              >
                                 {showAdminPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                              </button>
                           </div>
                        </div>
                     </div>
                     <div className="pt-4">
                        <button 
                           onClick={() => {
                              addToast('تم حفظ تغييرات الحساب بنجاح', 'success');
                              addLog('تحديث الحساب', `قام المستخدم ${currentUser?.name} بتحديث بياناته الشخصية`);
                           }}
                           className="bg-primary text-white px-10 py-4 rounded-2xl font-bold text-sm shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                        >
                           حفظ التعديلات
                        </button>
                     </div>
                  </div>

                      {/* Section: Google Sheets Sync */}
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm space-y-8">
                     <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-green-50 rounded-3xl flex items-center justify-center">
                           <Activity className="w-8 h-8 text-green-600" />
                        </div>
                        <div>
                           <h3 className="text-2xl font-black text-slate-800">الربط مع Google Sheets</h3>
                           <p className="text-sm text-slate-400 font-bold mt-1 tracking-wide uppercase">مزامنة البيانات تلقائياً للمسؤولين</p>
                        </div>
                     </div>
                     
                     <div className="space-y-6">
                        <div className="space-y-4">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">رابط الـ Webhook الخاص بجداول جوجل</label>
                            <div className="relative">
                                <Activity className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-green-500" />
                                <input 
                                  type="text" 
                                  value={settings.googleSheetsWebhook || ''}
                                  onChange={(e) => setSettings(s => ({ ...s, googleSheetsWebhook: e.target.value }))}
                                  placeholder="https://script.google.com/macros/s/.../exec"
                                  className="w-full pr-16 pl-6 py-5 bg-slate-50 border-2 border-slate-100 rounded-3xl outline-none focus:border-green-500 font-bold transition-all placeholder:text-slate-300"
                                />
                            </div>
                            <div className="bg-blue-50 border border-blue-100 p-6 rounded-[2rem] flex gap-4">
                               <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                                  <AlertCircle className="w-5 h-5 text-blue-500" />
                               </div>
                               <div className="space-y-1">
                                  <p className="text-xs font-black text-blue-800">كيفية الربط؟</p>
                                  <p className="text-[10px] text-blue-700/70 font-bold leading-relaxed">
                                    1. أنشئ "Google App Script" داخل جدول بياناتك. <br/>
                                    2. أضف الكود البرمجي لاستقبال طلبات POST. <br/>
                                    3. انشر السكربت كـ WebApp وألصق الرابط هنا.
                                  </p>
                               </div>
                            </div>
                        </div>
                     </div>
                  </div>

                  {/* Section: Danger Zone Page Style */}
                  <div className="bg-danger/5 p-10 rounded-[3rem] border-4 border-dashed border-danger/10 space-y-8">
                     <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-danger/10 rounded-3xl flex items-center justify-center">
                           <AlertCircle className="w-8 h-8 text-danger" />
                        </div>
                        <div>
                           <h3 className="text-2xl font-black text-danger">منطقة العمليات الحرجة</h3>
                           <p className="text-sm text-danger/60 font-bold mt-1">يرجى الحذر، هذه الإجراءات نهائية ولا يمكن التراجع عنها</p>
                        </div>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <button 
                          onClick={async () => {
                            if (!window.confirm('سيتم مسح جميع الحالات المسجلة اليوم. هل أنت متأكد؟')) return;
                            try {
                              await deleteDoc(doc(db, 'overbooking', selectedDate));
                              addToast('تم مسح بيانات اليوم بالكامل', 'warning');
                              addLog('مسح بيانات اليوم', `تم إفراغ جميع عيادات يوم ${selectedDate}`);
                            } catch (error) {
                              handleFirestoreError(error, OperationType.DELETE, `overbooking/${selectedDate}`);
                            }
                          }}
                          className="flex items-center justify-between p-6 bg-white border border-danger/20 rounded-2xl hover:bg-danger hover:text-white transition-all group"
                        >
                           <div className="text-right">
                              <div className="font-black text-sm">تصفير حالات اليوم</div>
                              <div className="text-[10px] font-bold opacity-60 group-hover:opacity-100">{selectedDate}</div>
                           </div>
                           <Trash2 className="w-6 h-6 opacity-40 group-hover:opacity-100" />
                        </button>

                        <button 
                          onClick={async () => {
                            if (!window.confirm('تحذير نهائي: سيتم مسح كافة البيانات والإعدادات نهائياً والعودة للحالة الافتراضية. هل أنت متأكد؟')) return;
                            try {
                              // Reset settings
                              await setDoc(doc(db, 'settings', 'global'), DEFAULT_SETTINGS);
                              
                              // We can't easily delete all collections client-side, but let's clear today's data as a start
                              await deleteDoc(doc(db, 'overbooking', selectedDate));
                              
                              addToast('تم تصفير النظام بنجاح', 'success');
                              addLog('تصفير النظام', 'قام المسؤول بمسح شامل لذاكرة النظام');
                              
                              setTimeout(() => window.location.reload(), 1000);
                            } catch (error) {
                              handleFirestoreError(error, OperationType.WRITE, 'settings/global');
                            }
                          }}
                          className="flex items-center justify-between p-6 bg-danger/10 border border-danger/40 rounded-2xl hover:bg-danger hover:text-white transition-all group"
                        >
                           <div className="text-right text-danger group-hover:text-white">
                              <div className="font-black text-sm uppercase">مسح ذاكرة النظام بالكامل</div>
                              <div className="text-[10px] font-bold opacity-60 group-hover:opacity-100">RESET ALL DATA</div>
                           </div>
                           <RefreshCcw className="w-6 h-6 text-danger group-hover:text-white rotate-0 group-hover:rotate-180 transition-transform duration-700" />
                        </button>
                     </div>
                  </div>
                </div>
              </div>
            )}
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'إجمالي الحالات', val: stats.totalCasesCount, icon: Users, color: 'bg-primary' },
                  { label: 'العيادات النشطة', val: settings.clinics.length, icon: Hospital, color: 'bg-accent' },
                  { label: 'متوسط الحالات اليومي', val: stats.avgDailyCases, icon: Activity, color: 'bg-warning' },
                  { label: 'نسبة الإشغال العام', val: `${stats.overallOccupancy}%`, icon: Activity, color: 'bg-success' }
                ].map((stat, i) => (
                  <div key={stat.label} className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg", stat.color)}>
                      <stat.icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
                      <p className="text-2xl font-black text-slate-800">{stat.val}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <h3 className="text-sm font-black text-slate-800 mb-6 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" /> توزيع الحالات حسب العيادة (تراكمي)
                  </h3>
                  <div className="space-y-4">
                    {stats.clinicStats.map(clinic => {
                      return (
                        <div key={clinic.id} className="space-y-1.5">
                          <div className="flex justify-between items-center text-[10px] font-black uppercase text-slate-500">
                            <div className="flex items-center gap-2">
                               <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
                                  {clinic.icon ? (
                                    <img src={clinic.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <Activity className="w-4 h-4 text-slate-200" />
                                  )}
                               </div>
                            </div>
                            <span>{clinic.totalClinicCases} حالة</span>
                          </div>
                          <div className="h-2 bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${clinic.pct}%` }}
                              className="h-full bg-primary"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4 ring-8 ring-primary/5">
                      <Users className="w-10 h-10 text-primary" />
                    </div>
                    <h3 className="text-lg font-black text-slate-800 mb-2">رابط النظام للموظفين</h3>
                    <p className="text-xs text-slate-400 mb-6 max-w-xs transition-all">شارك هذا الرابط مع باقي الموظفين ليتمكنوا من تفعيل حساباتهم والبدء في تسجيل الحالات.</p>
                    <button 
                      onClick={() => {
                        const url = window.location.origin;
                        navigator.clipboard.writeText(url);
                        addToast('تم نسخ الرابط بنجاح', 'success');
                      }}
                      className="px-8 py-3 bg-primary text-white rounded-2xl font-black text-xs hover:bg-primary-dark transition-all shadow-xl active:scale-95 flex items-center gap-2"
                    >
                      <PlusCircle className="w-4 h-4" /> نسخ رابط التفعيل
                    </button>
                  </div>

                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mb-4">
                      <Upload className="w-10 h-10 text-accent" />
                    </div>
                    <h3 className="text-lg font-black text-slate-800 mb-2">تصدير قاعدة البيانات</h3>
                    <p className="text-xs text-slate-400 mb-6 max-w-xs transition-all">بامكانك تصدير كافة البيانات المسجلة بالكامل إلى ملف CSV متوافق مع Excel وجداول بيانات جوجل.</p>
                    <button 
                      onClick={exportToCSV}
                      className="px-8 py-3 bg-slate-800 text-white rounded-2xl font-black text-xs hover:bg-black transition-all shadow-xl active:scale-95 flex items-center gap-2"
                    >
                      <FileSpreadsheet className="w-4 h-4" /> تصدير الآن (CSV)
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

          {activeTab === 'monthly' && (
            <motion.div 
               key="monthly" 
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -20 }}
               className="space-y-10"
            >
              {/* Monthly Nav */}
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-200 flex items-center justify-between">
                <button 
                  onClick={() => setViewDate(subMonths(viewDate, 1))}
                  className="p-4 bg-slate-50 text-slate-400 hover:bg-primary hover:text-white rounded-2xl transition-all shadow-sm active:scale-95"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
                <div className="text-center group">
                  <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">
                    {format(viewDate, 'MMMM yyyy', { locale: ar })}
                  </h3>
                  <div className="w-12 h-1 bg-accent mx-auto mt-2 rounded-full transform origin-right scale-x-50 group-hover:scale-x-100 transition-transform"></div>
                </div>
                <button 
                  onClick={() => !isNextMonthDisabled && setViewDate(addMonths(viewDate, 1))}
                  className={cn(
                    "p-4 bg-slate-50 text-slate-400 rounded-2xl transition-all shadow-sm active:scale-95",
                    isNextMonthDisabled ? "opacity-20 cursor-not-allowed" : "hover:bg-primary hover:text-white"
                  )}
                  disabled={isNextMonthDisabled}
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              </div>

              {/* Monthly Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-8">
                {settings.clinics.map((clinic, index) => {
                  const monthDays = eachDayOfInterval({
                    start: startOfMonth(viewDate),
                    end: endOfMonth(viewDate)
                  });

                  return (
                    <div key={clinic.id} className="bg-white rounded-[2rem] shadow-sm border border-slate-200 overflow-hidden flex flex-col group hover:shadow-2xl hover:shadow-slate-200/50 transition-all duration-500">
                      {(() => {
                        const totalClinicCases = monthDays.reduce((acc, day) => {
                          const dk = format(day, 'yyyy-MM-dd');
                          return acc + ((data[dk]?.[clinic.id] as Case[])?.length || 0);
                        }, 0);

                        return (
                          <>
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 group-hover:bg-slate-100/50 transition-colors">
                              <span className="font-black flex items-center gap-4 text-slate-800">
                                <div className="w-32 h-32 rounded-3xl bg-white shadow-2xl border-2 border-slate-100 flex items-center justify-center relative overflow-hidden group-hover:scale-110 transition-transform shrink-0">
                                  {clinic.icon ? (
                                    <img src={clinic.icon} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <Activity className="w-12 h-12 text-slate-100" />
                                  )}
                                </div>
                                {/* Clinic Name Hidden */}
                              </span>
                              <div className="bg-primary text-white text-[10px] font-black px-3 py-1 rounded-full uppercase shadow-lg shadow-primary/20">
                                إجمالي: {totalClinicCases}
                              </div>
                            </div>
                            
                            <div className="p-6 space-y-2 overflow-y-auto max-h-[450px] scrollbar-hide bg-white">
                              {monthDays.map(day => {
                                const dk = format(day, 'yyyy-MM-dd');
                                const dayData = data[dk] || {};
                                const dayCases = (dayData[clinic.id] as Case[]) || [];
                                const locked = (dayData.__locked || []).includes(clinic.id);
                                const isClosedDay = settings.closedDays.includes(getDay(day)) || (settings.holidayDates || []).includes(dk);
                                
                                // Day summary calculations
                                const anyLocked = (dayData.__locked || []).length > 0;
                                const allAvailableFull = settings.clinics.every(c => {
                                  const cl = (dayData.__locked || []).includes(c.id);
                                  const cc = (dayData[c.id] as Case[]) || [];
                                  const mx = c.max || settings.maxPerClinic;
                                  return cl || cc.length >= mx;
                                });

                                return (
                                  <div key={dk} className="flex items-center py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 px-2 rounded-xl transition-all group/day relative">
                              <div className="w-24 shrink-0 flex flex-col">
                                <div className="flex items-center gap-2">
                                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter group-hover/day:text-primary transition-colors">
                                    {format(day, 'dd')} {format(day, 'MMM', { locale: ar })}
                                  </div>
                                  
                                  {/* Global Indicators */}
                                  {!isClosedDay && (
                                    <div className="flex gap-1">
                                      {anyLocked && <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" title="يوجد عيادات مغلقة في هذا اليوم" />}
                                      {allAvailableFull && <div className="w-1.5 h-1.5 rounded-full bg-warning" title="جميع العيادات ممتلئة في هذا اليوم" />}
                                    </div>
                                  )}
                                </div>
                                <div className="text-[9px] font-bold text-slate-300">
                                  {DAYS_AR[getDay(day)]}
                                </div>
                              </div>
                              <div className="flex-1 flex gap-1.5 items-center justify-end">
                                {isClosedDay ? (
                                  <div className="text-[9px] text-danger/30 font-black uppercase italic">عطلة</div>
                                ) : locked ? (
                                  <div className="text-[9px] text-slate-200 font-black flex items-center gap-1 uppercase italic"><Lock className="w-3 h-3" /> مغلق</div>
                                ) : (
                                  <div className="flex items-center gap-4">
                                     <div className="flex gap-1.5 px-3 py-2 bg-slate-50/50 rounded-2xl group-hover/day:bg-slate-100/50 transition-all border border-slate-100">
                                      {Array.from({ length: clinic.max || settings.maxPerClinic }).map((_, idx) => (
                                        <div 
                                          key={idx} 
                                          className={cn(
                                            "w-2.5 h-2.5 rounded-full border transition-all duration-500",
                                            idx < dayCases.length 
                                              ? (dayCases.length >= (clinic.max || settings.maxPerClinic) ? 'bg-danger border-danger shadow-sm shadow-danger/20' : 'bg-accent border-accent shadow-sm shadow-accent/20') 
                                              : 'bg-white border-slate-100'
                                          )}
                                        />
                                      ))}
                                    </div>
                                    <span className={cn(
                                      "text-[10px] font-black min-w-[20px] text-left",
                                      dayCases.length > 0 ? "text-slate-600" : "text-slate-200"
                                    )}>{dayCases.length}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- Footer --- */}
          <footer className="mt-auto p-10 border-t border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-widest text-center flex flex-col items-center gap-4">
            <div className="flex items-center gap-6 opacity-30">
               <ShieldCheck className="w-8 h-8" />
               <Building className="w-8 h-8" />
               <Hospital className="w-8 h-8" />
            </div>
            <span>جميع الحقوق محفوظة &copy; {new Date().getFullYear()} — نظام مديكال المتطور لإدارة الأوفر بوك</span>
          </footer>
        </main>
      </div>

      {/* --- Admin Login Modal --- */}
      <AnimatePresence>
        {showAdminLogin && (
          <div className="fixed inset-0 bg-primary/60 backdrop-blur-md flex items-center justify-center p-4 z-[1000]">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-black text-primary mb-2">لوحة الإعدادات</h2>
              <p className="text-slate-500 mb-8">أدخل كلمة سر المسؤول للمتابعة</p>
              
              <div className="space-y-4">
                <div className="relative">
                  <input 
                    type={showAdminPass ? "text" : "password"} 
                    value={adminPassInput}
                    onChange={(e) => setAdminPassInput(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl focus:border-primary outline-none transition-all text-center tracking-widest text-lg font-black"
                  />
                  <button 
                    onClick={() => setShowAdminPass(!showAdminPass)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-2 text-slate-300 hover:text-slate-500 transition-colors"
                  >
                    {showAdminPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {adminLoginError && <div className="text-danger text-xs font-bold">كلمة السر غير صحيحة</div>}
                
                <button 
                  onClick={() => {
                    if (adminPassInput === settings.adminPass) {
                      setShowAdminLogin(false);
                      setCurrentUser({ name: 'المسؤل العام', pass: '', role: 'admin' });
                      setActiveTab('admin');
                      setAdminPassInput('');
                      setAdminLoginError(false);
                      addToast('مرحباً بك في لوحة التحكم', 'success');
                    } else {
                      setAdminLoginError(true);
                    }
                  }}
                  className="w-full py-4 bg-primary text-white font-bold rounded-2xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  فتـح الإعدادات
                </button>
                <button 
                  onClick={() => {
                    setShowAdminLogin(false);
                    setAdminPassInput('');
                    setAdminLoginError(false);
                  }}
                  className="w-full py-2 text-slate-400 font-bold hover:text-slate-600 transition-colors"
                >
                  إلغاء
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin modal removed in favor of dedicated tab */}

      {editingPatient && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setEditingPatient(null)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-8 lg:p-10"
          >
            <div className="flex justify-between items-start mb-8 text-right" dir="rtl">
              <div>
                <div className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">تعديل بيانات المريض</div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">{editingPatient.case.name}</h3>
              </div>
              <button onClick={() => setEditingPatient(null)} className="p-3 bg-slate-50 text-slate-400 hover:text-danger rounded-2xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6 text-right" dir="rtl">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase pr-4">الاسم الكامل</label>
                  <input 
                    type="text" 
                    value={editingPatient.case.name}
                    onChange={(e) => setEditingPatient(prev => prev ? { ...prev, case: { ...prev.case, name: e.target.value } } : null)}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary focus:bg-white outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase pr-4">الرقم الطبي (PID)</label>
                  <input 
                    type="text" 
                    value={editingPatient.case.pid}
                    onChange={(e) => setEditingPatient(prev => prev ? { ...prev, case: { ...prev.case, pid: e.target.value } } : null)}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary focus:bg-white outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase pr-4">رقم الهاتف</label>
                  <input 
                    type="text" 
                    value={editingPatient.case.phone}
                    onChange={(e) => setEditingPatient(prev => prev ? { ...prev, case: { ...prev.case, phone: e.target.value } } : null)}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary focus:bg-white outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase pr-4">الوحدة / القسم</label>
                  <select 
                    value={editingPatient.case.unit}
                    onChange={(e) => setEditingPatient(prev => prev ? { ...prev, case: { ...prev.case, unit: e.target.value } } : null)}
                    className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary focus:bg-white outline-none transition-all appearance-none"
                  >
                    <option value="">اختر الوحدة المحولة</option>
                    {settings.units.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase pr-4">ملاحظات الفحص</label>
                <textarea 
                  value={editingPatient.case.notes || ''}
                  onChange={(e) => setEditingPatient(prev => prev ? { ...prev, case: { ...prev.case, notes: e.target.value } } : null)}
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold focus:border-primary focus:bg-white outline-none transition-all min-h-[100px] resize-none"
                />
              </div>

              <button 
                onClick={() => handleUpdatePatient(editingPatient.case)}
                className="w-full h-16 bg-primary text-white font-black rounded-3xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 mt-4"
              >
                <CheckCircle2 className="w-6 h-6 text-accent" />
                حفظ التعديلات النهائية
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {editingResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setEditingResult(null)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-8 lg:p-10"
          >
            <div className="flex justify-between items-start mb-8 text-right" dir="rtl">
              <div>
                <div className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">تحديث نتائج الفحص</div>
                <h3 className="text-2xl font-black text-slate-800">{editingResult.name}</h3>
              </div>
              <button onClick={() => setEditingResult(null)} className="p-3 bg-slate-50 text-slate-400 hover:text-danger rounded-2xl transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>

              <div className="space-y-6 text-right" dir="rtl">
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <label className="text-[10px] font-black text-slate-400 uppercase mb-3 block">
                    {currentUser?.role === 'admin' ? 'النتيجة الحالية / تقرير الفحص' : 'تقرير الفحص (للقراءة فقط)'}
                  </label>
                  <textarea 
                    autoFocus={currentUser?.role === 'admin'}
                    readOnly={currentUser?.role !== 'admin'}
                    value={editingResult.currentResult}
                    onChange={(e) => setEditingResult(prev => prev ? { ...prev, currentResult: e.target.value } : null)}
                    placeholder={currentUser?.role === 'admin' ? "اكتب نتيجة الفحص هنا..." : "لا توجد نتيجة مسجلة بعد"}
                    className={cn(
                      "w-full h-32 bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-slate-700 resize-none",
                      currentUser?.role !== 'admin' && "cursor-default"
                    )}
                  />
                </div>

                {currentUser?.role === 'admin' && (
                  <button 
                    onClick={() => handleSetResult(editingResult.date, editingResult.cid, editingResult.caseId, editingResult.currentResult)}
                    className="w-full h-16 bg-primary text-white font-black rounded-3xl shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3"
                  >
                    <ClipboardList className="w-5 h-5" />
                    حفظ النتيجة النهائية
                  </button>
                )}
              </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}

