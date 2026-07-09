
/**
 * Theme & Branding Manager
 * Applied globally to handle Logo and Background changes
 */

const applyBranding = () => {
    // 1. Apply Login Background if on login page
    const loginBg = localStorage.getItem('cafe_login_bg');
    if (loginBg && document.querySelector('.auth-page')) {
        document.querySelector('.auth-page').style.backgroundImage = `url('${loginBg}')`;
    }

    // 2. Apply Custom Logo
    const customLogo = localStorage.getItem('cafe_logo');
    if (customLogo) {
        document.querySelectorAll('.navbar-logo').forEach(el => {
            el.innerHTML = `<img src="${customLogo}" alt="Logo" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;">`;
            el.style.backgroundColor = 'transparent'; // Remove brown background if image used
            el.style.boxShadow = 'none';
            el.classList.remove('animate-float');
        });

        // Also update auth logo
        const authLogo = document.querySelector('.auth-logo');
        if (authLogo) {
            authLogo.innerHTML = `<img src="${customLogo}" alt="Logo" style="width:100px; height:100px; object-fit:contain;">`;
            authLogo.style.fontSize = '0'; // hide emoji text space
        }
    }
};

document.addEventListener('DOMContentLoaded', applyBranding);
