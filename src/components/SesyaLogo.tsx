export default function SesyaLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Blue house */}
      <path d="M14 18 L6 26 L6 34 L22 34 L22 26 Z" stroke="#5BB8E4" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
      <path d="M4 20 L14 10 L24 20" stroke="#5BB8E4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Green house */}
      <path d="M26 18 L18 26 L18 34 L34 34 L34 26 Z" stroke="#7DC242" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
      <path d="M16 20 L26 10 L36 20" stroke="#7DC242" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Heart */}
      <path d="M20 23 C20 21 22 19.5 24 21 C26 19.5 28 21 28 23 C28 25.5 24 29 24 29 C24 29 20 25.5 20 23Z" stroke="#7DC242" strokeWidth="2" fill="none" strokeLinejoin="round"/>
    </svg>
  )
}
