function SvgIcon({ size = 20, children, className, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconUsers(props) {
  return (
    <SvgIcon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
      <circle cx="9" cy="7" r="3.2" {...stroke} />
      <path d="M22 21v-2a3.5 3.5 0 0 0-2.5-3.35" {...stroke} />
      <path d="M16.5 3.8a3.2 3.2 0 0 1 0 6.4" {...stroke} />
    </SvgIcon>
  );
}

export function IconDoctor(props) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="7" r="3.2" {...stroke} />
      <path d="M5.5 21v-1.5A4.5 4.5 0 0 1 10 15h4a4.5 4.5 0 0 1 4.5 4.5V21" {...stroke} />
      <path d="M12 11.5v3.5" {...stroke} />
      <path d="M10.2 13.2h3.6" {...stroke} />
    </SvgIcon>
  );
}

export function IconNurse(props) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="7.5" r="3" {...stroke} />
      <path d="M5.5 21v-1.2A4.8 4.8 0 0 1 10.3 15h3.4a4.8 4.8 0 0 1 4.8 4.8V21" {...stroke} />
      <path d="M9 4.2h6" {...stroke} />
      <path d="M12 2.8v2.8" {...stroke} />
    </SvgIcon>
  );
}

export function IconClock(props) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="8.2" {...stroke} />
      <path d="M12 7.5V12l3 2" {...stroke} />
    </SvgIcon>
  );
}

export function IconSyringe(props) {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 3.5l6 6" {...stroke} />
      <path d="M17.5 6.5l-1.8 1.8" {...stroke} />
      <path d="M12.8 5.2l6 6-8.3 8.3H4.5v-6l8.3-8.3z" {...stroke} />
      <path d="M8 14l2 2" {...stroke} />
    </SvgIcon>
  );
}

export function IconSnowflake(props) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3v18" {...stroke} />
      <path d="M12 7l-2.2-2.2M12 7l2.2-2.2" {...stroke} />
      <path d="M12 17l-2.2 2.2M12 17l2.2 2.2" {...stroke} />
      <path d="M4.8 7.5l14.4 9" {...stroke} />
      <path d="M7.2 6.2l-.4 3M6.5 9.8l3-.4" {...stroke} />
      <path d="M16.8 14.2l.4 3M17.5 14.2l-3 .4" {...stroke} />
      <path d="M19.2 7.5l-14.4 9" {...stroke} />
      <path d="M16.8 9.8l3-.4M17.5 9.8l-.4-3" {...stroke} />
      <path d="M7.2 17.8l-.4-3M6.5 14.2l3 .4" {...stroke} />
    </SvgIcon>
  );
}

export function IconPackage(props) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3.2L20 7.5v9L12 20.8 4 16.5v-9L12 3.2z" {...stroke} />
      <path d="M12 12v8.8" {...stroke} />
      <path d="M20 7.5L12 12 4 7.5" {...stroke} />
    </SvgIcon>
  );
}

export function IconShield(props) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3.2l7 2.8v5.4c0 4.4-2.9 7.6-7 9.4-4.1-1.8-7-5-7-9.4V6l7-2.8z" {...stroke} />
      <path d="M9.2 12.2l1.9 1.9 3.8-4" {...stroke} />
    </SvgIcon>
  );
}

export function IconClipboard(props) {
  return (
    <SvgIcon {...props}>
      <rect x="6" y="5" width="12" height="15" rx="2" {...stroke} />
      <path d="M9 5.2V4.2a1.5 1.5 0 0 1 1.5-1.4h3A1.5 1.5 0 0 1 15 4.2v1" {...stroke} />
      <path d="M9 11h6M9 14.5h6" {...stroke} />
    </SvgIcon>
  );
}

export function IconRefresh(props) {
  return (
    <SvgIcon {...props}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" {...stroke} />
      <path d="M20 4.5V9h-4.5" {...stroke} />
    </SvgIcon>
  );
}

export function IconDoor(props) {
  return (
    <SvgIcon {...props}>
      <path d="M5 21V5.5A1.5 1.5 0 0 1 6.5 4H15v17" {...stroke} />
      <path d="M15 4h2.5A1.5 1.5 0 0 1 19 5.5V21" {...stroke} />
      <path d="M5 21h14" {...stroke} />
      <path d="M12.2 12.2h.1" {...stroke} />
    </SvgIcon>
  );
}

export function IconThermometer(props) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3.5a2.2 2.2 0 0 0-2.2 2.2v7.4a3.4 3.4 0 1 0 4.4 0V5.7A2.2 2.2 0 0 0 12 3.5z" {...stroke} />
      <path d="M12 13.5V8" {...stroke} />
    </SvgIcon>
  );
}

export function IconHospital(props) {
  return (
    <SvgIcon {...props}>
      <path d="M4 21V6.5A1.5 1.5 0 0 1 5.5 5H11V3.5h2V5h5.5A1.5 1.5 0 0 1 20 6.5V21" {...stroke} />
      <path d="M4 21h16" {...stroke} />
      <path d="M10 10h4M12 8v4" {...stroke} />
      <path d="M8 21v-5h3v5M13 21v-5h3v5" {...stroke} />
    </SvgIcon>
  );
}

export function IconTrash(props) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 7h15" {...stroke} />
      <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" {...stroke} />
      <path d="M7 7l.8 12.2A1.5 1.5 0 0 0 9.3 20.5h5.4a1.5 1.5 0 0 0 1.5-1.3L17 7" {...stroke} />
    </SvgIcon>
  );
}

export function IconLogout(props) {
  return (
    <SvgIcon {...props}>
      <path d="M10 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H10" {...stroke} />
      <path d="M14 8l4 4-4 4" {...stroke} />
      <path d="M18 12H9.5" {...stroke} />
    </SvgIcon>
  );
}

export function IconMenu(props) {
  return (
    <SvgIcon {...props}>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" {...stroke} />
    </SvgIcon>
  );
}

export function IconClose(props) {
  return (
    <SvgIcon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...stroke} />
    </SvgIcon>
  );
}

export function IconChevronLeft(props) {
  return (
    <SvgIcon {...props}>
      <path d="M14.5 6l-6 6 6 6" {...stroke} />
    </SvgIcon>
  );
}

export function IconChevronRight(props) {
  return (
    <SvgIcon {...props}>
      <path d="M9.5 6l6 6-6 6" {...stroke} />
    </SvgIcon>
  );
}

export function IconArrowRight(props) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" {...stroke} />
    </SvgIcon>
  );
}

export function IconCheck(props) {
  return (
    <SvgIcon {...props}>
      <path d="M5.5 12.5l4.2 4.2L18.5 7.5" {...stroke} />
    </SvgIcon>
  );
}

export function IconPencil(props) {
  return (
    <SvgIcon {...props}>
      <path d="M14.2 4.8l5 5" {...stroke} />
      <path d="M5 19l1.2-5.2L15.8 4.2a1.6 1.6 0 0 1 2.3 0l1.7 1.7a1.6 1.6 0 0 1 0 2.3L10.2 17.8 5 19z" {...stroke} />
    </SvgIcon>
  );
}

export function IconCalendar(props) {
  return (
    <SvgIcon {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" {...stroke} />
      <path d="M8 3.8v3.2M16 3.8v3.2M4 10h16" {...stroke} />
    </SvgIcon>
  );
}

export function IconRepeat(props) {
  return (
    <SvgIcon {...props}>
      <path d="M17 2.8l3 3-3 3" {...stroke} />
      <path d="M4 12a6.5 6.5 0 0 1 6.5-6.5H20" {...stroke} />
      <path d="M7 21.2l-3-3 3-3" {...stroke} />
      <path d="M20 12a6.5 6.5 0 0 1-6.5 6.5H4" {...stroke} />
    </SvgIcon>
  );
}

export function IconSearch(props) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="6.2" {...stroke} />
      <path d="M16.2 16.2L20 20" {...stroke} />
    </SvgIcon>
  );
}

export function IconBot(props) {
  return (
    <SvgIcon {...props}>
      <rect x="5" y="8" width="14" height="11" rx="3" {...stroke} />
      <path d="M12 4.5V8" {...stroke} />
      <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 16.5h6" {...stroke} />
    </SvgIcon>
  );
}

export function IconFile(props) {
  return (
    <SvgIcon {...props}>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" {...stroke} />
      <path d="M14 3.5V8h4.5" {...stroke} />
    </SvgIcon>
  );
}

export function IconFlask(props) {
  return (
    <SvgIcon {...props}>
      <path d="M9.5 3.5h5" {...stroke} />
      <path d="M10.5 3.5v6.2L5.8 18a2 2 0 0 0 1.7 3h9a2 2 0 0 0 1.7-3l-4.7-8.3V3.5" {...stroke} />
      <path d="M8.2 14.5h7.6" {...stroke} />
    </SvgIcon>
  );
}

export function IconRocket(props) {
  return (
    <SvgIcon {...props}>
      <path d="M13.5 4.2c2.8 1.2 5.1 3.5 6.3 6.3-2.8 4.8-7.5 7.8-12.2 8.4l-2.6-2.6c.6-4.7 3.6-9.4 8.5-12.1z" {...stroke} />
      <path d="M9.2 14.8L6 18" {...stroke} />
      <circle cx="14.2" cy="9.8" r="1.2" {...stroke} />
      <path d="M5.5 15.5l3 3" {...stroke} />
    </SvgIcon>
  );
}

export function IconUser(props) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="8" r="3.4" {...stroke} />
      <path d="M5 20.2v-1.4A4.8 4.8 0 0 1 9.8 14h4.4A4.8 4.8 0 0 1 19 18.8v1.4" {...stroke} />
    </SvgIcon>
  );
}

export function IconStethoscope(props) {
  return (
    <SvgIcon {...props}>
      <path d="M6.5 4v7.5a3.5 3.5 0 0 0 7 0V4" {...stroke} />
      <path d="M6.5 4H5M13.5 4H15" {...stroke} />
      <path d="M17 14.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" {...stroke} />
      <path d="M13.5 11.5v1.2A5.3 5.3 0 0 0 17 17.8" {...stroke} />
    </SvgIcon>
  );
}

/** role: Doctor | Nurse | Hospital | Patient | Admin | string */
export function RoleAvatarIcon({ role, size = 22 }) {
  const key = String(role || '').toLowerCase();
  if (key === 'nurse' || key === 'nurses') return <IconNurse size={size} />;
  if (key === 'hospital') return <IconHospital size={size} />;
  if (key === 'patient' || key === 'patients' || key === 'user') return <IconUser size={size} />;
  if (key === 'admin' || key === 'shield') return <IconShield size={size} />;
  if (key === 'doctor' || key === 'doctors' || key === 'doc') return <IconDoctor size={size} />;
  return <IconUser size={size} />;
}

export function IconEye({ size = 18, color = 'currentColor', ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff({ size = 18, color = 'currentColor', ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function IconKey({ size = 18, color = 'currentColor', ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 2l-2 2m-1.5 1.5L16 7l-2 2-2-2-4 4a6.5 6.5 0 1 0 7 7l4-4-2-2 2-2 1.5-1.5z" />
      <circle cx="7.5" cy="16.5" r="1" fill={color} />
    </svg>
  );
}
