// Owner-approved monitoring configuration (Issue #103), NOT saved-state or GitHub evidence.
export const REPOSITORY_CATALOG = Object.freeze([
 Object.freeze({repository:'augusliang23-web/pm-dashboard',id:1221937556,project:'pm-dashboard',label:'PM Dashboard'}),
 Object.freeze({repository:'alin36242-web/inventory-management-tool',id:1344622897,project:'inventory',label:'Inventory Tool'}),
 Object.freeze({repository:'augusliang23-web/cc-h15a-claude-dispatch-lab',id:1423925660,project:'zero-copy',label:'Zero-Copy Lab'}),
 Object.freeze({repository:'augusliang23-web/Micro-SaaS-Command-Center',id:1352468489,project:'zero-copy',label:'Command Center'}),
]);
export const MONITORED_PROJECTS = Object.freeze([
 Object.freeze({id:'pm-dashboard',name:'PM Dashboard'}),
 Object.freeze({id:'inventory',name:'Inventory Tool'}),
 Object.freeze({id:'zero-copy',name:'Zero-Copy Development'}),
]);
export const catalogEntry = repo => REPOSITORY_CATALOG.find(x=>x.repository===repo);
export const catalogIdentity = entry => ({source:'CATALOG',projectId:'monitor:'+entry.id,repository:entry.repository,displayName:entry.label});
export function isCatalogIdentity(identity) {
 const entry=catalogEntry(identity?.repository);
 return Boolean(entry && identity.source==='CATALOG' && identity.projectId==='monitor:'+entry.id);
}
