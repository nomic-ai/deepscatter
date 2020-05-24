import * as Comlink from "comlink";
import { Table, Column, Float32Vector } from 'apache-arrow';

/*
function TableMutator() {

  post_table(buffer) {
    table = Table.from(buffer)
  }

  post_functions(key, func) {
    this.key = key
    this.func = Function("datum", func)
  }

  run_transform() {
    const data = Array(table.length)
    let i = 0
    for (let row of table) {
      data[i] = this.func(row)
      i++
    }
    const vector = Float32Vector.from(data)
    const table = Table.new(
      Column.new(this.key, vector)
    )
    return table.serialize()
  }

}

const mutate = function(key, buffer) {
  console.log(key)
  console.log("Hello from workerland")
  const data = new TableMutator()
  data.post_table(buffer)
  data.post_functions(key)
}
*/

const obj = {
  counter: 0,
  inc(i=1) {
    console.log(this.counter+=i)
    this.counter+=i;
  },
};

Comlink.expose(obj);

//Comlink.expose(TableMutator)
