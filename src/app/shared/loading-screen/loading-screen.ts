import { Component, input } from '@angular/core';

@Component({
  selector: 'mb-loading-screen',
  templateUrl: './loading-screen.html',
  styleUrl: './loading-screen.scss',
})
export class LoadingScreen {
  readonly title = input('Opening the book');
  readonly text = input('');
  readonly progress = input(0);

  protected percent(): number {
    return Math.round(Math.min(Math.max(this.progress(), 0), 1) * 100);
  }
}
