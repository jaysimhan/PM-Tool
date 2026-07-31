import React from 'react';

export const SubtaskIcon = ({ className = "w-4 h-4", ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg 
        className={`fill-current ${className}`} 
        viewBox="0 0 24 24" 
        aria-hidden="true" 
        focusable="false"
        {...props}
    >
        <path d="M20,15c-1.9,0-3.4,1.3-3.9,3H7c-2.8,0-5-2.2-5-5v-3h14.1c0.4,1.7,2,3,3.9,3c2.2,0,4-1.8,4-4s-1.8-4-4-4 c-1.9,0-3.4,1.3-3.9,3H2V3c0-0.6-0.4-1-1-1S0,2.4,0,3v10c0,3.9,3.1,7,7,7h9.1c0.4,1.7,2,3,3.9,3c2.2,0,4-1.8,4-4S22.2,15,20,15z M20,7c1.1,0,2,0.9,2,2s-0.9,2-2,2s-2-0.9-2-2S18.9,7,20,7z M20,21c-1.1,0-2-0.9-2-2s0.9-2,2-2s2,0.9,2,2S21.1,21,20,21z" />
    </svg>
);
