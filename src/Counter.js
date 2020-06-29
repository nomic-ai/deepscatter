export default class Counter extends Map {
  // A counter that allows arbitrary-length keys.

  get_count(x) {
    return super.get(x) || 0
  }

  get_counter(x) {
    const current = super.get(x)
    if (current) {return current} else {
      super.set(x, new Counter())
      return super.get(x)
    }
  }

  merge(counter) {
   // increment w/ values from another counter. Could be faster if it didn't
   // re-descend on every pair.
   for (let row of counter.value_iter()) {
     this.add(...row)
   }
  }

  inc(...values) {
   // Increment by 1.
   this.add(1, ...values)
  }

  add(i, ...values) {
    if (values.length == 1) {
      this.set(values[0], this.get_count(values[0]) + i)
    }
    else {
      const child = this.get_counter(values[0])
      child.add(i, ...values.slice(1))
    }
  }

  is_counter() {

  }

  values() {
   return Array.from(this.value_iter())
  }

  *value_iter() {
   for (let [k, v] of this.entries()) {
     if (v.is_counter) {
       for (let row of v.value_iter()) {
         yield [row[0], k, ...row.slice(1)]
       }
     } else {
       yield [v, k]
     }
   }
  }
}
