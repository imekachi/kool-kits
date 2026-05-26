export function checkCanCopyTabUrl(tabUrl) {
  if (!tabUrl) {
    return false
  }

  try {
    new URL(tabUrl)
  } catch {
    return false
  }

  return true
}
