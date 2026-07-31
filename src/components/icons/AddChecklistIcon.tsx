import React from 'react';

export const AddChecklistIcon = ({ className = "w-4 h-4", ...props }: React.SVGProps<SVGSVGElement>) => (
    <svg 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        {...props}
    >
        <path d="M2 5.5L3.21429 7L7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 12.5L3.21429 14L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 19.5L3.21429 21L7.5 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 19L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M22 12L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M22 5L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
);
