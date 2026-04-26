// FIX-HIGH-7 — extracted to WorkOrders/ subfolder. This file remains as a
// re-export shim so router/sidebar imports of `./mechanic/WorkOrders` keep
// resolving without churn.
export { default } from './WorkOrders/index.jsx'
