// The launcher reports stored memos for the current physical page, independently of the
// overlay's shared/private display filter. Deleted notes never count.
export function memoSummary(state,page){
 const matches=note=>!note.deleted&&page&&(note.target.kind==='print'?note.target.no===page.no:note.target.page===page.key);
 const total=(state.allNotes||state.notes).filter(matches).length;
 const shown=state.notes.filter(matches).length;
 return {total,shown,hidden:Math.max(0,total-shown)};
}
