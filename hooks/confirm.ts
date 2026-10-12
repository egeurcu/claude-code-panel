// Yanlış tıklamaya karşı iki adımlı buton: ilk basış "kurar", 3 sn içindeki ikinci basış işi yapar
export const twoStep = () => {
  let armed: { key: string; at: number } | undefined
  return {
    isArmed: (key: string) => armed?.key === key && Date.now() - armed.at < 3000,
    // true dönerse çağıran işi yapar; false ise buton kuruldu, yeniden çizilmeli
    press(key: string) {
      if (this.isArmed(key)) {
        armed = undefined
        return true
      }
      armed = { key, at: Date.now() }
      return false
    },
  }
}
