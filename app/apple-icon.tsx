import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #179E77 0%, #0E7658 55%, #084C39 100%)',
          borderRadius: 40,
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          width="156"
          height="156"
        >
          <g
            fill="none"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path stroke="#FFFFFF" d="M 45.5 17.0 A 20.2 20.2 0 1 0 45.5 47.0" />
            <path stroke="#FFFFFF" d="M 26.8 20.0 V 44.0" />
            <path stroke="#86F7D0" d="M 26.8 32.0 L 38.4 20.5" />
            <path stroke="#F5BF5A" d="M 26.8 32.0 L 39.8 44.5" />
          </g>
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
