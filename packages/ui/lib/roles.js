// Role helpers. Keep role identity logic centralised so adding a new role
// (e.g. 'tech') touches one file instead of every gate site.

export const isTech = (user) => user?.role === 'tech'
